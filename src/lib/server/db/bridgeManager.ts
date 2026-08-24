/**
 * Manages persistent PowerShell SQL bridge processes (scripts/sql-bridge.ps1).
 *
 * One bridge == one live SqlConnection with the user's Windows identity.
 * Sheets each get their own bridge (keyed `sheet:<id>`) so temp tables and
 * session state persist across runs; metadata queries share one bridge per
 * server (keyed `meta:<server>`).
 *
 * Requests are serialized per bridge (the worker is single-threaded); cancel
 * is implemented by killing the process — the next run respawns it.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { ConnectionProfile } from '$lib/db/types';
import { getConnection } from '$lib/server/store';

export interface SqlColumn {
	name: string;
	type: string;
}

export interface SqlResultSet {
	columns: SqlColumn[];
	rows: unknown[][];
	rowCount: number;
	truncated: boolean;
}

export interface SqlMessage {
	text: string;
	severity: number;
	line: number;
}

export interface QueryResult {
	ok: boolean;
	resultSets?: SqlResultSet[];
	messages?: SqlMessage[];
	rowsAffected?: number;
	elapsedMs?: number;
	error?: string;
	line?: number;
	number?: number;
}

interface Pending {
	resolve: (v: any) => void;
	reject: (e: Error) => void;
	timer: NodeJS.Timeout;
}

const BRIDGE_SCRIPT = path.resolve(process.cwd(), 'scripts', 'sql-bridge.ps1');
const DB_WORKER_SCRIPT = path.resolve(process.cwd(), 'scripts', 'db-worker.mjs');
const REQUEST_MARGIN_MS = 10_000;

export class Bridge {
	readonly key: string;
	server = '';
	database = '';
	profile: ConnectionProfile | null = null;
	private proc: ChildProcessWithoutNullStreams | null = null;
	private pending = new Map<number, Pending>();
	private nextId = 1;
	private chain: Promise<unknown> = Promise.resolve();
	dead = false;

	constructor(key: string) {
		this.key = key;
	}

	private spawnProc(profile: ConnectionProfile): void {
		const isSqlServer = profile.type === 'mssql';
		const proc = spawn(
			isSqlServer ? 'pwsh' : process.execPath,
			isSqlServer
				? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BRIDGE_SCRIPT]
				: [DB_WORKER_SCRIPT],
			{ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
		);
		createInterface({ input: proc.stdout }).on('line', (line) => {
			let msg: any;
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			const p = this.pending.get(msg.id);
			if (p) {
				this.pending.delete(msg.id);
				clearTimeout(p.timer);
				p.resolve(msg);
			}
		});
		proc.stderr.on('data', (d) => console.error(`[bridge ${this.key}]`, d.toString().trim()));
		proc.on('error', (err) => {
			// pwsh missing / failed to spawn — fail pending requests, don't crash
			this.dead = true;
			for (const [, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new Error(`Failed to start SQL bridge (pwsh): ${err.message}`));
			}
			this.pending.clear();
		});
		proc.on('exit', () => {
			this.dead = true;
			for (const [, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new Error('Query cancelled (connection process ended)'));
			}
			this.pending.clear();
		});
		this.proc = proc;
	}

	/** Serialize requests: the worker handles one at a time. */
	private send<T>(payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
		const run = () =>
			new Promise<T>((resolve, reject) => {
				if (!this.proc || this.dead) return reject(new Error('Bridge not running'));
				const id = this.nextId++;
				const timer = setTimeout(() => {
					this.pending.delete(id);
					this.kill();
					reject(new Error(`Bridge request timed out after ${Math.round(timeoutMs / 1000)}s`));
				}, timeoutMs);
				this.pending.set(id, { resolve, reject, timer });
				this.proc.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
			});
		const result = this.chain.then(run, run);
		this.chain = result.catch(() => {});
		return result;
	}

	async connect(profile: ConnectionProfile, database: string): Promise<void> {
		if (!this.proc || this.dead) {
			this.dead = false;
			this.spawnProc(profile);
		}
		const res = await this.send<{ ok: boolean; error?: string }>(
			profile.type === 'mssql'
				? { op: 'connect', server: profile.server, database }
				: { op: 'connect', profile, database },
			30_000
		);
		if (!res.ok) throw new Error(res.error ?? 'Connect failed');
		this.server = profile.id;
		this.database = database;
		this.profile = profile;
	}

	query(sql: string, opts: { maxRows?: number; timeout?: number } = {}): Promise<QueryResult> {
		const timeout = opts.timeout ?? 300;
		return this.send<QueryResult>(
			{
				op: 'query',
				sqlB64: Buffer.from(sql, 'utf-8').toString('base64'),
				maxRows: opts.maxRows ?? 10_000,
				timeout
			},
			timeout * 1000 + REQUEST_MARGIN_MS
		);
	}

	kill(): void {
		this.dead = true;
		if (this.proc) {
			this.proc.kill();
			this.proc = null;
		}
	}
}

// Survive Vite HMR in dev: keep the registry on globalThis so module reloads
// don't orphan live pwsh processes.
const g = globalThis as unknown as { __dbtoolBridges?: Map<string, Bridge> };
const bridges: Map<string, Bridge> = (g.__dbtoolBridges ??= new Map());

/** Get (spawning/reconnecting as needed) a bridge connected to server+database. */
export async function ensureBridge(key: string, server: string, database: string): Promise<Bridge> {
	const profile = getConnection(server);
	if (!profile) throw new Error(`Unknown connection: ${server}`);
	let b = bridges.get(key);
	if (!b || b.dead || (b.profile && b.profile.type !== profile.type)) {
		b?.kill();
		b = new Bridge(key);
		bridges.set(key, b);
	}
	if (b.server !== server || b.database !== database || b.dead) {
		await b.connect(profile, database);
	}
	return b;
}

export function killBridge(key: string): boolean {
	const b = bridges.get(key);
	if (!b) return false;
	b.kill();
	bridges.delete(key);
	return true;
}

/**
 * Close every live connection to a database (or, with no database, everything
 * on a server including its metadata connection). Sheets reconnect
 * transparently on their next run.
 */
export function killBridgesFor(server: string, database?: string): number {
	let closed = 0;
	for (const [key, b] of bridges) {
		if (b.server !== server) continue;
		if (database != null && b.database !== database) continue;
		if (!b.dead) closed++;
		b.kill();
		bridges.delete(key);
	}
	return closed;
}
