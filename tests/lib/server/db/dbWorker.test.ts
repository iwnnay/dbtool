import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

let worker: ChildProcessWithoutNullStreams | null = null;

afterEach(() => {
	worker?.kill();
	worker = null;
});

describe('SQLite database worker', () => {
	it('preserves a connection and returns array-shaped result sets', async () => {
		worker = spawn(process.execPath, [path.resolve('scripts/db-worker.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
		const pending = new Map<number, (message: any) => void>();
		createInterface({ input: worker.stdout }).on('line', (line) => {
			const message = JSON.parse(line);
			pending.get(message.id)?.(message);
			pending.delete(message.id);
		});
		let id = 0;
		const request = (body: Record<string, unknown>) => new Promise<any>((resolve) => {
			const requestId = ++id;
			pending.set(requestId, resolve);
			worker!.stdin.write(`${JSON.stringify({ id: requestId, ...body })}\n`);
		});

		expect((await request({ op: 'connect', profile: { id: 'test', name: 'test', type: 'sqlite', path: ':memory:' }, database: 'main' })).ok).toBe(true);
		expect((await request({ op: 'query', sqlB64: Buffer.from('CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT)').toString('base64') })).ok).toBe(true);
		await request({ op: 'query', sqlB64: Buffer.from("INSERT INTO people(name) VALUES ('Ada')").toString('base64') });
		const selected = await request({ op: 'query', sqlB64: Buffer.from('SELECT id, name FROM people').toString('base64') });
		expect(selected.ok).toBe(true);
		expect(selected.resultSets[0].columns.map((column: any) => column.name)).toEqual(['id', 'name']);
		expect(selected.resultSets[0].rows).toEqual([[1, 'Ada']]);
		const columns = await request({ op: 'query', sqlB64: Buffer.from('PRAGMA "main".table_xinfo("people")').toString('base64') });
		expect(columns.resultSets[0].rows.map((row: unknown[]) => row[1])).toEqual(['id', 'name']);
	});
});
