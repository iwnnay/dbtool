#!/usr/bin/env node
// State migration runner — invoked by the deployment console as `npm run db:migrate`
// (the svelte app-type default migrateCommand). Deliberately DB-agnostic: a
// migration is just a script that reshapes whatever persistent state this app
// keeps — a JSON file, a SQLite table (via Node's built-in node:sqlite), an
// external DB, anything. There is no ORM and nothing to "pull out": delete this
// file + the migrations/ dir + the db:migrate script and the dependency is gone.
//
// Convention (mirrors the console's own scripts/migrate.js):
//   - migrations live in ./migrations as NNNN_short-description.js (zero-padded
//     numeric prefix sets order)
//   - each exports `export async function up(context)`; one-way only, no down
//   - applied migrations are tracked in a JSON file so they don't re-run
//   - be idempotent and tolerate missing state (first install may be empty)
//
// With no migrations present it prints a friendly no-op and exits 0, so a fresh
// app (this template ships with none — tables are created on demand) deploys
// cleanly.
import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const migrationsDir = path.join(projectRoot, 'migrations');
const dataRoot = process.env.DATA_ROOT
	? path.resolve(process.env.DATA_ROOT)
	: path.join(projectRoot, 'data');
const trackerPath = process.env.MIGRATIONS_STATE_FILE
	? path.resolve(process.env.MIGRATIONS_STATE_FILE)
	: path.join(dataRoot, '.migrations-applied.json');

async function readTracker() {
	if (!existsSync(trackerPath)) return { applied: [] };
	const raw = await readFile(trackerPath, 'utf-8');
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new Error(
			`migrations tracker is corrupt at ${trackerPath} (${cause.message}); resolve manually before migrating.`
		);
	}
	return { applied: Array.isArray(parsed?.applied) ? parsed.applied : [] };
}

async function writeTracker(tracker) {
	await mkdir(path.dirname(trackerPath), { recursive: true });
	const tmp = `${trackerPath}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmp, JSON.stringify(tracker, null, 2), 'utf-8');
	await rename(tmp, trackerPath);
}

async function discoverMigrations() {
	if (!existsSync(migrationsDir)) return [];
	const entries = await readdir(migrationsDir);
	return entries.filter((name) => /^\d{4}.*\.js$/.test(name)).sort();
}

async function run() {
	const all = await discoverMigrations();
	if (all.length === 0) {
		console.log('[migrate] No migrations defined — nothing to migrate.');
		return;
	}

	const tracker = await readTracker();
	const appliedSet = new Set(tracker.applied);
	const pending = all.filter((name) => !appliedSet.has(name));
	if (pending.length === 0) {
		console.log(`[migrate] up to date (${all.length} known, 0 pending)`);
		return;
	}

	console.log(`[migrate] ${pending.length} pending`);
	for (const name of pending) {
		console.log(`[migrate] running ${name}`);
		const mod = await import(pathToFileURL(path.join(migrationsDir, name)).href);
		if (typeof mod.up !== 'function') {
			throw new Error(`${name} must export an async function named 'up'`);
		}
		await mod.up({ paths: { projectRoot, dataRoot } });
		tracker.applied.push(name);
		await writeTracker(tracker);
		console.log(`[migrate] applied ${name}`);
	}
	console.log(`[migrate] done. ${pending.length} migration(s) applied.`);
}

run().catch((err) => {
	console.error('[migrate] FAILED:', err.message);
	process.exit(1);
});
