/**
 * File-backed persistence under ./data — servers the user has registered and
 * query sheets (auto-saved after every run). No database dependency; sheets
 * are individual JSON files so they're greppable and easy to back up.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConnectionProfile, ConnectionProfileInput } from '$lib/db/types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SHEETS_DIR = path.join(DATA_DIR, 'sheets');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function ensureDirs(): void {
	fs.mkdirSync(SHEETS_DIR, { recursive: true });
}

// ---------- servers ----------

interface Config {
	connections: ConnectionProfile[];
}

function readConfig(): Config {
	ensureDirs();
	try {
		const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as {
			connections?: ConnectionProfile[];
			servers?: string[];
		};
		if (Array.isArray(raw.connections)) return { connections: raw.connections };
		// Transparent migration from the original SQL Server-only string list.
		return {
			connections: (raw.servers ?? []).map((server) => ({
				id: server,
				name: server,
				type: 'mssql' as const,
				server
			}))
		};
	} catch {
		return { connections: [] };
	}
}

function writeConfig(cfg: Config): void {
	ensureDirs();
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, '\t'));
}

export function listConnections(): ConnectionProfile[] {
	return readConfig().connections;
}

export function getConnection(id: string): ConnectionProfile | null {
	return listConnections().find((connection) => connection.id === id) ?? null;
}

function uniqueId(name: string, existing: ConnectionProfile[]): string {
	const base = name.trim().replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-|-$/g, '') || 'connection';
	if (!existing.some((connection) => connection.id === base)) return base;
	for (let suffix = 2; ; suffix++) {
		if (!existing.some((connection) => connection.id === `${base}-${suffix}`)) return `${base}-${suffix}`;
	}
}

export function addConnection(input: ConnectionProfileInput & { id?: string }): ConnectionProfile[] {
	const cfg = readConfig();
	const id = input.id?.trim() || uniqueId(input.name, cfg.connections);
	if (cfg.connections.some((connection) => connection.id === id)) throw new Error(`Connection id already exists: ${id}`);
	const connection = { ...input, id } as ConnectionProfile;
	cfg.connections.push(connection);
	writeConfig(cfg);
	return cfg.connections;
}

export function addSqlServer(name: string): ConnectionProfile[] {
	return addConnection({ name, type: 'mssql', server: name });
}

export function removeConnection(id: string): ConnectionProfile[] {
	const cfg = readConfig();
	cfg.connections = cfg.connections.filter((connection) => connection.id !== id);
	writeConfig(cfg);
	return cfg.connections;
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
	open: boolean;
}

function normalize(stored: Partial<Sheet>): Sheet {
	return { ...(stored as Sheet), open: stored.open !== false };
}

function sheetPath(id: string): string {
	// ids are UUIDs we generated; reject anything path-like just in case
	if (!/^[\w-]+$/.test(id)) throw new Error('Bad sheet id');
	return path.join(SHEETS_DIR, `${id}.json`);
}

export function listSheets(options: { includeClosed?: boolean } = {}): Sheet[] {
	ensureDirs();
	const sheets: Sheet[] = [];
	for (const f of fs.readdirSync(SHEETS_DIR)) {
		if (!f.endsWith('.json')) continue;
		try {
			sheets.push(normalize(JSON.parse(fs.readFileSync(path.join(SHEETS_DIR, f), 'utf-8'))));
		} catch {
			// skip corrupt file
		}
	}
	const visible = options.includeClosed ? sheets : sheets.filter((sheet) => sheet.open);
	return visible.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

export function getSheet(id: string): Sheet | null {
	try {
		return normalize(JSON.parse(fs.readFileSync(sheetPath(id), 'utf-8')));
	} catch {
		return null;
	}
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
		updatedAt: now,
		open: true
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
	const sheet: Sheet = normalize(JSON.parse(fs.readFileSync(p, 'utf-8')));
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
