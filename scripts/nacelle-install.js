#!/usr/bin/env node
// nacelle-install — fetch nacelle-* packages from the source-of-truth monorepo
// into ./nacelle/ (gitignored), pinned by nacelle.lock. Wired as this app's
// install hooks so a plain `npm install` "just works":
//
//   preinstall  → node scripts/nacelle-install.js           fetch locked commit(s) into ./nacelle
//   postinstall → node scripts/nacelle-install.js --ensure  finish installing fetched pkgs' deps
//   (manual)    → node scripts/nacelle-install.js --update   move to each ref's newest commit
//
// Why the postinstall: npm reads a `file:` dependency's manifest while building
// its tree — which happens *before* preinstall fetches ./nacelle — so on a cold
// install core's transitive deps get skipped. `--ensure` notices they're missing
// and runs one more `npm install` (now ./nacelle is present, so they resolve).
// It's guarded by a sentinel + env var, so it runs at most once and never loops.
//
// Dependency-free (Node built-ins + git over your existing SSH auth): it runs
// before node_modules exists.
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = process.cwd();

function readJson(p) {
	return JSON.parse(readFileSync(p, 'utf8'));
}

function git(args, opts = {}) {
	const r = spawnSync('git', args, { encoding: 'utf8', ...opts });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed:\n${(r.stderr || r.stdout || '').trim()}`);
	}
	return (r.stdout || '').trim();
}

// npm-style specs carry a `git+` prefix; raw git doesn't want it.
function gitUrl(registry) {
	return registry.replace(/^git\+/, '');
}

function resolveRef(url, ref) {
	const out = git(['ls-remote', url, ref]);
	const sha = out.split('\n')[0]?.split('\t')[0]?.trim();
	if (!sha) throw new Error(`could not resolve ref '${ref}' at ${url}`);
	return sha;
}

function fetchSubdir(url, commit, subpath, dest) {
	const tmp = join(tmpdir(), `nacelle-fetch-${process.pid}-${Date.now()}`);
	mkdirSync(tmp, { recursive: true });
	try {
		git(['init', '-q'], { cwd: tmp });
		git(['remote', 'add', 'origin', url], { cwd: tmp });
		// Cone-mode sparse checkout limits the working tree to the package subdir;
		// blob:none keeps the fetch from downloading unrelated file contents.
		git(['sparse-checkout', 'set', subpath], { cwd: tmp });
		git(['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', commit], { cwd: tmp });
		git(['checkout', '-q', 'FETCH_HEAD'], { cwd: tmp });
		const src = join(tmp, subpath);
		if (!existsSync(src)) throw new Error(`path '${subpath}' not found at ${commit.slice(0, 7)}`);
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(dirname(dest), { recursive: true });
		cpSync(src, dest, { recursive: true });
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

function normalizedRanges(ranges) {
	return Object.entries(ranges ?? {})
		.sort(([leftName], [rightName]) => (leftName < rightName ? -1 : leftName > rightName ? 1 : 0))
		.map(([dependencyName, range]) => `${dependencyName}@${range}`)
		.join(',');
}

function packagesWithStaleLockEntry(packageNames) {
	const packageLockPath = join(root, 'package-lock.json');
	if (!existsSync(packageLockPath)) return [];
	const packageLock = readJson(packageLockPath);
	const stale = [];

	for (const name of packageNames) {
		const fetchedManifestPath = join(root, 'nacelle', name, 'package.json');
		if (!existsSync(fetchedManifestPath)) continue;
		const fetchedManifest = readJson(fetchedManifestPath);
		const recordedEntry = packageLock.packages?.[`nacelle/${name}`];

		if (!recordedEntry) {
			stale.push(name);
			continue;
		}

		const fields = ['dependencies', 'devDependencies', 'peerDependencies'];
		const drifted = fields.some(
			(field) => normalizedRanges(recordedEntry[field]) !== normalizedRanges(fetchedManifest[field])
		);
		if (drifted) stale.push(name);
	}

	return stale;
}

function syncPackageLock(reason) {
	console.log(`[nacelle] ${reason} → npm install …`);
	const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
		cwd: root,
		stdio: 'inherit',
		shell: true,
		env: { ...process.env, NACELLE_ENSURING: '1' }
	});
	return result.status ?? 0;
}

// --- fetch (preinstall / --update) ---------------------------------------

function install({ update }) {
	const manifest = readJson(join(root, 'package.json')).nacelle;
	if (!manifest?.packages || !Object.keys(manifest.packages).length) return;
	const url = gitUrl(manifest.registry);

	const lockPath = join(root, 'nacelle.lock');
	const lock = existsSync(lockPath) ? readJson(lockPath) : {};

	for (const [name, spec] of Object.entries(manifest.packages)) {
		const ref = spec.ref || 'main';
		const subpath = spec.path;
		const dest = join(root, 'nacelle', name);
		const locked = lock[name];

		// Standard lock behavior: use the locked commit unless --update (or no lock yet).
		const commit = update || !locked?.commit ? resolveRef(url, ref) : locked.commit;

		if (!update && locked?.commit === commit && existsSync(join(dest, 'package.json'))) {
			console.log(`[nacelle] ${name} up to date (${commit.slice(0, 7)})`);
			continue;
		}

		console.log(`[nacelle] fetching ${name} @ ${ref} (${commit.slice(0, 7)}) …`);
		fetchSubdir(url, commit, subpath, dest);
		lock[name] = { path: subpath, ref, commit };
		console.log(`[nacelle] installed ${name} → nacelle/${name}`);
	}

	writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

	if (!update || process.env.NACELLE_ENSURING) return;

	const stale = packagesWithStaleLockEntry(Object.keys(manifest.packages));
	if (!stale.length) return;

	const status = syncPackageLock(`package-lock.json out of sync with ${stale.join(', ')}`);
	if (status !== 0) {
		throw new Error(
			`npm install exited with code ${status} while syncing package-lock.json against ${stale
				.map((name) => `nacelle/${name}@${lock[name]?.commit?.slice(0, 7) ?? 'unknown'}`)
				.join(', ')} — package-lock.json is still stale and \`npm ci\` will fail`
		);
	}
}

// --- ensure fetched packages' deps are installed (postinstall) ------------

function ensure() {
	if (process.env.NACELLE_ENSURING) return; // already inside the follow-up install
	const manifest = readJson(join(root, 'package.json')).nacelle;
	if (!manifest?.packages) return;

	// Any top-level dependency of a fetched package that isn't in node_modules yet
	// means the cold-install ordering skipped them — do one completing install.
	const missing = [];
	for (const name of Object.keys(manifest.packages)) {
		const corePkg = join(root, 'nacelle', name, 'package.json');
		if (!existsSync(corePkg)) continue;
		const deps = Object.keys(readJson(corePkg).dependencies || {});
		for (const d of deps) {
			if (!existsSync(join(root, 'node_modules', ...d.split('/')))) missing.push(d);
		}
	}
	const stale = packagesWithStaleLockEntry(Object.keys(manifest.packages));
	if (!missing.length && !stale.length) return;

	const reason = missing.length
		? `completing install of fetched deps (${missing.length} missing)`
		: `package-lock.json out of sync with ${stale.join(', ')}`;
	process.exit(syncPackageLock(reason));
}

try {
	if (process.argv.includes('--ensure')) ensure();
	else install({ update: process.argv.includes('--update') });
} catch (err) {
	console.error(`[nacelle] FAILED: ${err.message}`);
	process.exit(1);
}
