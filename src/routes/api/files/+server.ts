import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const SQLITE_EXTENSIONS = new Set(['.db', '.db3', '.sqlite', '.sqlite3']);

function filesystemRoots(): string[] {
	if (process.platform !== 'win32') return ['/'];
	return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
		.filter((root) => existsSync(root));
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const requested = url.searchParams.get('path')?.trim() || process.cwd();
		let directory = path.resolve(requested);
		const target = await stat(directory);
		if (!target.isDirectory()) directory = path.dirname(directory);

		const entries = (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() || entry.isFile())
			.map((entry) => ({
				name: entry.name,
				path: path.join(directory, entry.name),
				directory: entry.isDirectory(),
				sqlite: entry.isFile() && SQLITE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
			}))
			.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));

		const parent = path.dirname(directory);
		return json({
			path: directory,
			parent: parent === directory ? null : parent,
			roots: filesystemRoots(),
			entries
		});
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
