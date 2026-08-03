/**
 * File-backed persistence under ./data — servers the user has registered and
 * query sheets (auto-saved after every run). No database dependency; sheets
 * are individual JSON files so they're greppable and easy to back up.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SHEETS_DIR = path.join(DATA_DIR, 'sheets');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function ensureDirs(): void {
	fs.mkdirSync(SHEETS_DIR, { recursive: true });
}

// ---------- servers ----------

interface Config {
	servers: string[];
}

function readConfig(): Config {
	ensureDirs();
	try {
		return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
	} catch {
		return { servers: [] };
	}
}

function writeConfig(cfg: Config): void {
	ensureDirs();
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, '\t'));
}

export function listServers(): string[] {
	return readConfig().servers;
}

export function addServer(name: string): string[] {
	const cfg = readConfig();
	if (!cfg.servers.includes(name)) cfg.servers.push(name);
	writeConfig(cfg);
	return cfg.servers;
}

export function removeServer(name: string): string[] {
	const cfg = readConfig();
	cfg.servers = cfg.servers.filter((s) => s !== name);
	writeConfig(cfg);
	return cfg.servers;
}

// ---------- sheets ----------

export interface Sheet {
	id: string;
	name: string;
	server: string;
	database: string;
	sql: string;
	position: number;
	createdAt: string;
	updatedAt: string;
}

function sheetPath(id: string): string {
	// ids are UUIDs we generated; reject anything path-like just in case
	if (!/^[\w-]+$/.test(id)) throw new Error('Bad sheet id');
	return path.join(SHEETS_DIR, `${id}.json`);
}

export function listSheets(): Sheet[] {
	ensureDirs();
	const sheets: Sheet[] = [];
	for (const f of fs.readdirSync(SHEETS_DIR)) {
		if (!f.endsWith('.json')) continue;
		try {
			sheets.push(JSON.parse(fs.readFileSync(path.join(SHEETS_DIR, f), 'utf-8')));
		} catch {
			// skip corrupt file
		}
	}
	return sheets.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

export function createSheet(partial: Partial<Sheet>): Sheet {
	ensureDirs();
	const now = new Date().toISOString();
	const existing = listSheets();
	const sheet: Sheet = {
		id: randomUUID(),
		name: partial.name ?? nextName(existing),
		server: partial.server ?? '',
		database: partial.database ?? '',
		sql: partial.sql ?? '',
		position: existing.length ? Math.max(...existing.map((s) => s.position)) + 1 : 0,
		createdAt: now,
		updatedAt: now
	};
	fs.writeFileSync(sheetPath(sheet.id), JSON.stringify(sheet, null, '\t'));
	return sheet;
}

function nextName(existing: Sheet[]): string {
	const used = new Set(existing.map((s) => s.name));
	for (let i = 1; ; i++) {
		const name = `Query ${i}`;
		if (!used.has(name)) return name;
	}
}

export function updateSheet(id: string, patch: Partial<Sheet>): Sheet {
	const p = sheetPath(id);
	const sheet: Sheet = JSON.parse(fs.readFileSync(p, 'utf-8'));
	const updated: Sheet = {
		...sheet,
		...patch,
		id: sheet.id,
		createdAt: sheet.createdAt,
		updatedAt: new Date().toISOString()
	};
	fs.writeFileSync(p, JSON.stringify(updated, null, '\t'));
	return updated;
}

export function deleteSheet(id: string): void {
	try {
		fs.unlinkSync(sheetPath(id));
	} catch {
		// already gone
	}
}
