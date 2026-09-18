import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GET } from '../../src/routes/api/files/+server';

let testDirectory = '';

beforeEach(async () => {
	testDirectory = await mkdtemp(path.join(tmpdir(), 'dbtool-files-'));
	await mkdir(path.join(testDirectory, 'folder'));
	await writeFile(path.join(testDirectory, 'app.sqlite'), 'sqlite');
	await writeFile(path.join(testDirectory, 'notes.txt'), 'text');
});

afterEach(async () => {
	if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
});

const event = (target: string) => ({
	url: new URL(`http://test.local/api/files?path=${encodeURIComponent(target)}`)
}) as never;

describe('file finder endpoint', () => {
	it('lists folders first and identifies common SQLite file extensions', async () => {
		const response = await GET(event(testDirectory));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.path).toBe(path.resolve(testDirectory));
		expect(body.parent).toBe(path.dirname(path.resolve(testDirectory)));
		expect(body.entries).toEqual([
			expect.objectContaining({ name: 'folder', directory: true, sqlite: false }),
			expect.objectContaining({ name: 'app.sqlite', directory: false, sqlite: true }),
			expect.objectContaining({ name: 'notes.txt', directory: false, sqlite: false })
		]);
	});

	it('opens a file path at its containing folder and rejects missing paths', async () => {
		const fileResponse = await GET(event(path.join(testDirectory, 'app.sqlite')));
		expect((await fileResponse.json()).path).toBe(path.resolve(testDirectory));

		const missing = await GET(event(path.join(testDirectory, 'missing')));
		expect(missing.status).toBe(400);
		expect(await missing.json()).toEqual(expect.objectContaining({ error: expect.any(String) }));
	});
});
