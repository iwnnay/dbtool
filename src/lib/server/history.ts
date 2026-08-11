import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'history.sqlite3');
const TABLE = 'query_runs';

export interface HistoryMessage {
	text: string;
	severity?: number;
	line?: number;
}

export interface HistoryEntry {
	id: number;
	ranAt: string;
	server: string;
	database: string;
	sheetId: string;
	sheetName: string;
	sql: string;
	ok: boolean;
	elapsedMs: number;
	rowCount: number;
	rowsAffected: number;
	error: string | null;
	messages: HistoryMessage[];
}

interface HistoryDatabase {
	exec(sql: string): void;
	prepare(sql: string): {
		run(...params: unknown[]): unknown;
		all(...params: unknown[]): Record<string, unknown>[];
		get(...params: unknown[]): Record<string, unknown> | undefined;
	};
}

let historyDatabase: HistoryDatabase | null = null;

function open(): HistoryDatabase {
	if (historyDatabase) return historyDatabase;
	fs.mkdirSync(DATA_DIR, { recursive: true });
	const DatabaseConstructor = DatabaseSync as unknown as new (path: string) => HistoryDatabase;
	const opened = new DatabaseConstructor(HISTORY_PATH);
	opened.exec('PRAGMA journal_mode = WAL');
	opened.exec(`
		CREATE TABLE IF NOT EXISTS ${TABLE} (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ran_at TEXT NOT NULL,
			server TEXT NOT NULL,
			database TEXT NOT NULL,
			sheet_id TEXT NOT NULL,
			sheet_name TEXT NOT NULL,
			sql TEXT NOT NULL,
			ok INTEGER NOT NULL,
			elapsed_ms INTEGER NOT NULL,
			row_count INTEGER NOT NULL,
			rows_affected INTEGER NOT NULL,
			error TEXT,
			messages_json TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_query_runs_ran_at ON ${TABLE} (ran_at DESC);
	`);
	historyDatabase = opened;
	return historyDatabase;
}

export function recordRun(entry: Omit<HistoryEntry, 'id'>): void {
	try {
		open()
			.prepare(
				`INSERT INTO ${TABLE}
					(ran_at, server, database, sheet_id, sheet_name, sql, ok, elapsed_ms,
					 row_count, rows_affected, error, messages_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				entry.ranAt,
				entry.server,
				entry.database,
				entry.sheetId,
				entry.sheetName,
				entry.sql,
				entry.ok ? 1 : 0,
				entry.elapsedMs,
				entry.rowCount,
				entry.rowsAffected,
				entry.error,
				JSON.stringify(entry.messages)
			);
	} catch {
		return;
	}
}

function toEntry(row: Record<string, unknown>): HistoryEntry {
	return {
		id: Number(row.id),
		ranAt: String(row.ran_at),
		server: String(row.server),
		database: String(row.database),
		sheetId: String(row.sheet_id),
		sheetName: String(row.sheet_name),
		sql: String(row.sql),
		ok: Number(row.ok) === 1,
		elapsedMs: Number(row.elapsed_ms),
		rowCount: Number(row.row_count),
		rowsAffected: Number(row.rows_affected),
		error: row.error == null ? null : String(row.error),
		messages: JSON.parse(String(row.messages_json || '[]'))
	};
}

export function listRuns(
	options: { limit?: number; search?: string } = {}
): HistoryEntry[] {
	const limit = Math.max(1, Math.min(2000, options.limit ?? 300));
	const search = (options.search ?? '').trim();
	const where = search
		? `WHERE sql LIKE ? ESCAPE '\\' OR database LIKE ? ESCAPE '\\' OR sheet_name LIKE ? ESCAPE '\\'`
		: '';
	const parameters: unknown[] = [];
	if (search) {
		const searchToken = `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
		parameters.push(searchToken, searchToken, searchToken);
	}
	parameters.push(limit);
	const rows = open()
		.prepare(`SELECT * FROM ${TABLE} ${where} ORDER BY id DESC LIMIT ?`)
		.all(...parameters);
	return rows.map(toEntry);
}

export function countRuns(): number {
	const row = open().prepare(`SELECT COUNT(*) AS total FROM ${TABLE}`).get();
	return row ? Number(row.total) : 0;
}

export function clearRuns(): number {
	const removed = countRuns();
	open().exec(`DELETE FROM ${TABLE}`);
	return removed;
}
