/**
 * Zone-aware SQL completion (experimental — to remove, delete this file and
 * the `language.data.of` line in Editor.svelte).
 *
 * The statement under the cursor is split into zones by its last clause
 * keyword: after FROM/JOIN/APPLY/INTO/UPDATE you get table names; after
 * SELECT/WHERE/ON/GROUP BY/ORDER BY/HAVING/SET/VALUES you get columns; with
 * no keyword yet, both. Columns come from the statement's own FROM/JOIN/
 * UPDATE/INTO tables (aliases understood, loaded once through the catalog
 * cache); when the statement has no tables yet, they come from a server-side
 * prefix search across the whole database.
 */
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { statementAt } from '$lib/sql/split';
import { api, type DbObject } from './api';
import { catalog } from './catalog.svelte';

export type Zone = 'table' | 'column' | 'any';

interface TableRef {
	db?: string;
	schema: string;
	table: string;
	alias?: string;
}

const TABLE_KW = new Set(['from', 'join', 'apply', 'into', 'update']);
const ZONE_RE = /\b(select|from|join|apply|into|update|where|on|having|set|by|values)\b/gi;

export function zoneAt(text: string, pos: number): Zone {
	const before = text.slice(0, pos);
	ZONE_RE.lastIndex = 0;
	let last: { kw: string; end: number } | null = null;
	let m: RegExpExecArray | null;
	while ((m = ZONE_RE.exec(before))) last = { kw: m[1].toLowerCase(), end: m.index + m[0].length };
	if (!last) return 'any';
	if (TABLE_KW.has(last.kw)) {
		// INSERT INTO t (col, col...) — inside the parens it's columns again
		if (last.kw === 'into' && before.slice(last.end).includes('(')) return 'column';
		return 'table';
	}
	return 'column';
}

const NOT_ALIAS = new Set([
	'on', 'where', 'inner', 'left', 'right', 'full', 'cross', 'outer', 'join', 'group',
	'order', 'having', 'union', 'except', 'intersect', 'select', 'set', 'as', 'with',
	'apply', 'option', 'for', 'pivot', 'unpivot', 'tablesample', 'values'
]);

const REF_RE = /\b(?:from|join|apply|into|update)\s+((?:\[[^\]]*\]|\w+)(?:\.(?:\[[^\]]*\]|\w+))*)(?:\s+(?:as\s+)?(\w+))?/gi;

export function parseTableRefs(sql: string): TableRef[] {
	const refs: TableRef[] = [];
	REF_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = REF_RE.exec(sql))) {
		const parts = m[1].split('.').map((p) => p.replace(/^\[|\]$/g, ''));
		const table = parts[parts.length - 1];
		if (!table) continue;
		refs.push({
			db: parts.length >= 3 ? parts[parts.length - 3] : undefined,
			schema: parts.length >= 2 ? parts[parts.length - 2] : 'dbo',
			table,
			alias: m[2] && !NOT_ALIAS.has(m[2].toLowerCase()) ? m[2] : undefined
		});
	}
	return refs;
}

// ---- table-name options, cached per objects array ----

const tableOptCache = new WeakMap<DbObject[], Completion[]>();

async function tableOptions(
	server: string,
	database: string,
	schemaFilter: string | null
): Promise<Completion[]> {
	const objs =
		(await catalog.loadObjects(server, database)) ?? catalog.objects[`${server}|${database}`] ?? [];
	if (schemaFilter) {
		return objs
			.filter((o) => o.type !== 'procedure' && o.schema.toLowerCase() === schemaFilter)
			.map((o) => ({ label: o.name, type: o.type === 'view' ? 'interface' : 'class', detail: o.type, boost: 1 }));
	}
	let opts = tableOptCache.get(objs);
	if (!opts) {
		opts = objs
			.filter((tableOrView) => tableOrView.type !== 'procedure')
			.map((o) => ({
				label: o.name,
				type: o.type === 'view' ? 'interface' : 'class',
				detail: o.schema,
				apply: o.schema === 'dbo' ? o.name : `${o.schema}.${o.name}`,
				boost: 1
			}));
		tableOptCache.set(objs, opts);
	}
	return opts;
}

// ---- column options from the statement's own tables ----

async function refColumnOptions(
	server: string,
	database: string,
	refs: TableRef[]
): Promise<Completion[]> {
	const options: Completion[] = [];
	await Promise.all(
		refs.map(async (r) => {
			const db = r.db ?? database;
			const key = `${server}|${db}|${r.schema}|${r.table}`;
			if (catalog.errors[key]) return; // known-bad ref (subquery alias, typo) — don't retry
			const cols = await catalog.loadColumns(server, db, r.schema, r.table);
			for (const c of cols ?? catalog.columns[key] ?? []) {
				options.push({
					label: c.name,
					type: 'property',
					detail: `${r.alias ?? r.table} · ${c.display}`,
					boost: 2
				});
			}
		})
	);
	return options;
}

// ---- whole-database fallback (no FROM yet), cached per prefix ----

const searchCache = new Map<string, Completion[]>();

async function allColumnOptions(
	server: string,
	database: string,
	prefix: string
): Promise<Completion[]> {
	const key = `${server}|${database}|${prefix.toLowerCase()}`;
	let options = searchCache.get(key);
	if (!options) {
		const { columns } = await api.columnSearch(server, database, prefix);
		options = columns.map((c) => ({
			label: c.name,
			type: 'property',
			detail: c.count > 1 ? `${c.count} tables` : `${c.example} · ${c.type}`,
			boost: 2
		}));
		searchCache.set(key, options);
	}
	return options;
}

export function columnCompletionSource(getConn: () => { server: string; database: string }) {
	return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
		const { server, database } = getConn();
		if (!server || !database) return null;

		const dotted = ctx.matchBefore(/\w+\.\w*$/);
		const word = ctx.matchBefore(/\w+$/);
		if (!dotted && !word && !ctx.explicit) return null;

		const stmt = statementAt(ctx.state.doc.toString(), ctx.pos);
		const zone: Zone = stmt ? zoneAt(stmt.text, ctx.pos - stmt.start) : 'any';
		const refs = stmt ? parseTableRefs(stmt.text) : [];

		const qualifier = dotted ? dotted.text.slice(0, dotted.text.indexOf('.')).toLowerCase() : null;
		const from = dotted ? dotted.from + dotted.text.indexOf('.') + 1 : (word?.from ?? ctx.pos);

		const options: Completion[] = [];
		let serverSearch = false;

		if (zone !== 'column') {
			options.push(...(await tableOptions(server, database, qualifier)));
		}
		if (zone !== 'table') {
			if (qualifier) {
				const matched = refs.filter(
					(r) =>
						r.alias?.toLowerCase() === qualifier ||
						(!r.alias && r.table.toLowerCase() === qualifier)
				);
				options.push(...(await refColumnOptions(server, database, matched)));
			} else if (refs.length > 0) {
				options.push(...(await refColumnOptions(server, database, refs)));
			} else {
				const prefix = word?.text ?? '';
				if (prefix.length >= 2 || ctx.explicit) {
					options.push(...(await allColumnOptions(server, database, prefix)));
					serverSearch = true;
				}
			}
		}

		if (options.length === 0) return null;
		// Server-searched results are prefix-dependent and capped — don't let CM
		// reuse them as the prefix grows.
		return serverSearch ? { from, options } : { from, options, validFor: /^\w*$/ };
	};
}
