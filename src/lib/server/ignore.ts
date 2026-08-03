/**
 * Per-database table ignore lists (ported from aco_db_discovery's table mask —
 * NGDev has ~9,500 tables of which only the few thousand with production data
 * matter). Ignored tables are hidden from the explorer, search, autocomplete
 * and datamaps; explicit single-table lookups (columns, insert) bypass the
 * list on purpose — if the user names a table, they get to see it.
 *
 * Entries are `schema.table` or bare `table` names, matched case-insensitively.
 * Stored in data/ignore/ (gitignored), one JSON per server+database.
 */
import fs from 'node:fs';
import path from 'node:path';

const IGNORE_DIR = path.resolve(process.cwd(), 'data', 'ignore');

function filePath(server: string, database: string): string {
	const safe = `${server}__${database}`.replace(/[^\w.-]/g, '_');
	return path.join(IGNORE_DIR, `${safe}.json`);
}

export function loadIgnoreList(server: string, database: string): string[] {
	try {
		const data = JSON.parse(fs.readFileSync(filePath(server, database), 'utf-8'));
		return Array.isArray(data.ignored) ? data.ignored : [];
	} catch {
		return [];
	}
}

export function saveIgnoreList(server: string, database: string, ignored: string[]): string[] {
	const clean = [...new Set(ignored.map((s) => s.trim()).filter(Boolean))].sort();
	fs.mkdirSync(IGNORE_DIR, { recursive: true });
	fs.writeFileSync(filePath(server, database), JSON.stringify({ ignored: clean }, null, '\t'));
	return clean;
}

export function ignoreSet(server: string, database: string): Set<string> {
	return new Set(loadIgnoreList(server, database).map((s) => s.toLowerCase()));
}

export function isIgnored(set: Set<string>, schema: string, table: string): boolean {
	if (set.size === 0) return false;
	return set.has(`${schema}.${table}`.toLowerCase()) || set.has(table.toLowerCase());
}
