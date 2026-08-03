/**
 * Per-database datamaps: a full mechanical schema snapshot (tables, row counts,
 * PKs, column lists) fingerprinted per table, enriched with one-line table
 * descriptions from Ollama. Stored under data/datamaps/ (gitignored).
 *
 * Regeneration is incremental: unchanged tables (same fingerprint) keep their
 * descriptions; only new/changed tables go back to the LLM. Description passes
 * cover the top DESCRIBE_LIMIT tables by row count — on a 9000-table database
 * the tail is overwhelmingly empty template tables (aco_db_discovery lesson).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { ensureBridge } from './bridgeManager';
import { ignoreSet, isIgnored } from '../ignore';
import { chat } from '../ollama';

const DATAMAP_DIR = path.resolve(process.cwd(), 'data', 'datamaps');

export interface DatamapTable {
	schema: string;
	name: string;
	rowCount: number;
	pk: string | null;
	columns: string;
	hash: string;
	description?: string;
}

export interface Datamap {
	server: string;
	database: string;
	generatedAt: string;
	tables: Record<string, DatamapTable>; // key: schema.name
}

export interface DatamapJob {
	running: boolean;
	phase: 'snapshot' | 'describe' | 'done' | 'error';
	done: number;
	total: number;
	error?: string;
}

function describeLimit(): number {
	return parseInt(env.DATAMAP_DESCRIBE_LIMIT || '300', 10);
}

function mapPath(server: string, database: string): string {
	const safe = `${server}__${database}`.replace(/[^\w.-]/g, '_');
	return path.join(DATAMAP_DIR, `${safe}.json`);
}

export function loadDatamap(server: string, database: string): Datamap | null {
	try {
		return JSON.parse(fs.readFileSync(mapPath(server, database), 'utf-8'));
	} catch {
		return null;
	}
}

function saveDatamap(map: Datamap): void {
	fs.mkdirSync(DATAMAP_DIR, { recursive: true });
	fs.writeFileSync(mapPath(map.server, map.database), JSON.stringify(map, null, '\t'));
}

function bracket(name: string): string {
	return `[${name.replace(/]/g, ']]')}]`;
}

/** One round trip: every table with row count, PK columns and column list. */
async function schemaSnapshot(server: string, database: string): Promise<DatamapTable[]> {
	const db = bracket(database);
	const bridge = await ensureBridge(`meta:${server}`, server, 'master');
	const res = await bridge.query(
		`SELECT s.name, t.name, CAST(ISNULL(p.rows, 0) AS bigint), pk.cols, col.cols
		 FROM ${db}.sys.tables t
		 JOIN ${db}.sys.schemas s ON s.schema_id = t.schema_id
		 OUTER APPLY (SELECT TOP 1 pp.rows FROM ${db}.sys.partitions pp
		              WHERE pp.object_id = t.object_id AND pp.index_id IN (0, 1)) p
		 OUTER APPLY (SELECT STRING_AGG(CAST(c.name + ' ' + ty.name AS nvarchar(MAX)), ', ')
		                       WITHIN GROUP (ORDER BY c.column_id) AS cols
		              FROM ${db}.sys.columns c
		              JOIN ${db}.sys.types ty ON ty.user_type_id = c.user_type_id
		              WHERE c.object_id = t.object_id) col
		 OUTER APPLY (SELECT STRING_AGG(c2.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
		              FROM ${db}.sys.index_columns ic
		              JOIN ${db}.sys.indexes ix ON ix.object_id = ic.object_id
		                AND ix.index_id = ic.index_id AND ix.is_primary_key = 1
		              JOIN ${db}.sys.columns c2 ON c2.object_id = ic.object_id
		                AND c2.column_id = ic.column_id
		              WHERE ic.object_id = t.object_id) pk
		 ORDER BY s.name, t.name`,
		{ maxRows: 50_000, timeout: 300 }
	);
	if (!res.ok) throw new Error(res.error ?? 'schema snapshot failed');
	const ignored = ignoreSet(server, database);
	const rows = (res.resultSets?.[0]?.rows ?? []).filter(
		(r) => !isIgnored(ignored, String(r[0]), String(r[1]))
	);
	return rows.map((r) => {
		const columns = r[4] == null ? '' : String(r[4]);
		const pk = r[3] == null ? null : String(r[3]);
		return {
			schema: String(r[0]),
			name: String(r[1]),
			rowCount: Number(r[2]),
			pk,
			columns,
			hash: createHash('sha1').update(`${pk ?? ''}|${columns}`).digest('hex').slice(0, 16)
		};
	});
}

/** How many tables changed/appeared since the stored map (cheap staleness probe). */
export async function checkStale(
	server: string,
	database: string
): Promise<{ stale: number; total: number }> {
	const existing = loadDatamap(server, database);
	const snap = await schemaSnapshot(server, database);
	if (!existing) return { stale: snap.length, total: snap.length };
	let stale = 0;
	for (const t of snap) {
		const prev = existing.tables[`${t.schema}.${t.name}`];
		if (!prev || prev.hash !== t.hash) stale++;
	}
	return { stale, total: snap.length };
}

const DESCRIBE_SYSTEM = `You write one-line descriptions of SQL Server tables for a "datamap" that helps an LLM pick the right tables when writing queries.

For EACH table in the input, output exactly one line:
schema.TableName: <what one row represents and what the table is used for>

Rules:
- Infer meaning from the table and column names. Be specific and concise (max ~25 words).
- Output ONLY those lines, one per input table, same order, no preamble, no markdown.`;

async function describeBatch(tables: DatamapTable[]): Promise<Map<string, string>> {
	const input = tables
		.map((t) => `${t.schema}.${t.name} [${t.rowCount} rows]${t.pk ? ` PK(${t.pk})` : ''}: ${t.columns}`)
		.join('\n');
	const out = await chat(
		[
			{ role: 'system', content: DESCRIBE_SYSTEM },
			{ role: 'user', content: input }
		],
		{ temperature: 0.15 }
	);
	const byKey = new Map<string, string>();
	for (const line of out.split('\n')) {
		const m = line.match(/^\s*[-*]?\s*`?([\w]+\.[\w$ ]+?)`?\s*:\s*(.+)$/);
		if (!m) continue;
		const key = m[1].trim();
		if (tables.some((t) => `${t.schema}.${t.name}` === key)) byKey.set(key, m[2].trim());
	}
	return byKey;
}

// Job registry survives HMR
const g = globalThis as unknown as { __dbtoolDatamapJobs?: Map<string, DatamapJob> };
const jobs: Map<string, DatamapJob> = (g.__dbtoolDatamapJobs ??= new Map());

export function jobStatus(server: string, database: string): DatamapJob | null {
	return jobs.get(`${server}|${database}`) ?? null;
}

/**
 * Build/refresh the datamap. Snapshot is always full; descriptions are only
 * requested for new/changed tables (or all when `force`), top-N by row count,
 * in batches of 20. Runs in the background — poll jobStatus for progress.
 */
export function startGenerate(server: string, database: string, force = false): DatamapJob {
	const key = `${server}|${database}`;
	const existing = jobs.get(key);
	if (existing?.running) return existing;

	const job: DatamapJob = { running: true, phase: 'snapshot', done: 0, total: 0 };
	jobs.set(key, job);

	void (async () => {
		try {
			const prev = force ? null : loadDatamap(server, database);
			const snap = await schemaSnapshot(server, database);

			const tables: Record<string, DatamapTable> = {};
			for (const t of snap) {
				const k = `${t.schema}.${t.name}`;
				const old = prev?.tables[k];
				tables[k] = old && old.hash === t.hash ? { ...t, description: old.description } : t;
			}

			const candidates = Object.values(tables)
				.sort((a, b) => b.rowCount - a.rowCount)
				.slice(0, describeLimit())
				.filter((t) => !t.description);

			job.phase = 'describe';
			job.total = candidates.length;

			// Save the mechanical map immediately — Ask works (undescribed) while
			// descriptions fill in.
			const map: Datamap = { server, database, generatedAt: new Date().toISOString(), tables };
			saveDatamap(map);

			const BATCH = 20;
			for (let i = 0; i < candidates.length; i += BATCH) {
				const batch = candidates.slice(i, i + BATCH);
				const described = await describeBatch(batch);
				for (const t of batch) {
					const d = described.get(`${t.schema}.${t.name}`);
					if (d) tables[`${t.schema}.${t.name}`].description = d;
				}
				job.done = Math.min(i + BATCH, candidates.length);
				saveDatamap(map);
			}

			job.phase = 'done';
			job.running = false;
		} catch (e) {
			job.phase = 'error';
			job.error = (e as Error).message;
			job.running = false;
		}
	})();

	return job;
}

/**
 * Prompt grounding for Ask: guidance + catalog ordered by row count, with a
 * relevance boost so tables lexically matching the question always make the
 * cut even in 9000-table databases.
 */
export function buildAskContext(map: Datamap, question: string, maxChars = 70_000): string {
	// Filter against the CURRENT ignore list so ignoring takes effect on maps
	// built before the list existed, without a rebuild.
	const ignored = ignoreSet(map.server, map.database);
	const all = Object.values(map.tables).filter((t) => !isIgnored(ignored, t.schema, t.name));
	const terms = (question.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []).filter(
		(w) => !['the', 'and', 'that', 'with', 'for', 'from', 'can', 'you', 'query', 'all'].includes(w)
	);

	function score(t: DatamapTable): number {
		const hay = `${t.schema}.${t.name} ${t.columns} ${t.description ?? ''}`.toLowerCase();
		let s = 0;
		for (const w of terms) if (hay.includes(w)) s += w.length;
		return s;
	}

	const byRelevance = [...all].sort((a, b) => score(b) - score(a));
	const relevant = byRelevance.filter((t) => score(t) > 0).slice(0, 60);
	const bySize = [...all].sort((a, b) => b.rowCount - a.rowCount);

	const picked = new Map<string, DatamapTable>();
	for (const t of relevant) picked.set(`${t.schema}.${t.name}`, t);
	for (const t of bySize) {
		if (picked.size >= 400) break;
		picked.set(`${t.schema}.${t.name}`, t);
	}

	const lines: string[] = [];
	let used = 0;
	for (const t of picked.values()) {
		const line =
			`${t.schema}.${t.name} [${t.rowCount} rows]${t.pk ? ` PK(${t.pk})` : ''}: ${t.columns}` +
			(t.description ? `\n  ^ ${t.description}` : '');
		if (used + line.length > maxChars) break;
		lines.push(line);
		used += line.length + 1;
	}

	const capped = lines.length < all.length;
	return [
		`# Database: ${map.database} on ${map.server} (datamap generated ${map.generatedAt})`,
		'',
		capped
			? `# Table Catalog — ${lines.length} of ${all.length.toLocaleString()} tables (question-relevant first, then largest; the rest are mostly empty). If a table is not listed it may still exist.`
			: '# Full Table Catalog',
		'Format: schema.table [rows] PK(...): column type, ...  (^ = table description)',
		'',
		...lines
	].join('\n');
}
