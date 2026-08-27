import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(), createInterface: vi.fn(), getConnection: vi.fn(),
	line: undefined as undefined | ((line: string) => void),
	stderr: undefined as undefined | ((data: { toString(): string }) => void),
	events: new Map<string, (...args: any[]) => void>(),
	writes: [] as Record<string, unknown>[], kill: vi.fn(), respond: true,
	response: vi.fn((payload: Record<string, unknown>): Record<string, unknown> =>
		payload.op === 'connect' ? { ok: true } : { ok: true, resultSets: [] })
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:readline', () => ({ createInterface: mocks.createInterface }));
vi.mock('$lib/server/store', () => ({ getConnection: mocks.getConnection }));

import { Bridge, ensureBridge, killBridge, killBridgesFor } from '$lib/server/db/bridgeManager';

const mssql = { id: 'ms', name: 'MS', type: 'mssql' as const, server: 'host' };
const sqlite = { id: 'lite', name: 'Lite', type: 'sqlite' as const, path: 'db.sqlite' };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.events.clear();
	mocks.writes.length = 0;
	mocks.respond = true;
	mocks.response.mockImplementation((payload) => payload.op === 'connect' ? { ok: true } : { ok: true, resultSets: [] });
	mocks.getConnection.mockReturnValue(mssql);
	mocks.createInterface.mockReturnValue({ on: (_event: string, callback: (line: string) => void) => { mocks.line = callback; } });
	mocks.spawn.mockImplementation(() => ({
		stdout: {},
		stderr: { on: (_event: string, callback: typeof mocks.stderr) => { mocks.stderr = callback; } },
		stdin: { write: (raw: string) => {
			const payload = JSON.parse(raw) as Record<string, unknown>;
			mocks.writes.push(payload);
			if (mocks.respond) mocks.line?.(JSON.stringify({ id: payload.id, ...mocks.response(payload) }));
		} },
		on: (event: string, callback: (...args: any[]) => void) => mocks.events.set(event, callback),
		kill: mocks.kill
	}));
});

describe('Bridge process protocol', () => {
	it('spawns PowerShell for SQL Server, connects, queries, and resolves line responses', async () => {
		const bridge = new Bridge('one');
		await bridge.connect(mssql, 'app');
		expect(mocks.spawn).toHaveBeenCalledWith('pwsh', expect.arrayContaining(['-NonInteractive', '-File']), expect.objectContaining({ windowsHide: true }));
		expect(mocks.writes[0]).toEqual(expect.objectContaining({ op: 'connect', server: 'host', database: 'app' }));
		mocks.response.mockReturnValueOnce({ ok: true, rowsAffected: 2 });
		expect(await bridge.query('select ü', { maxRows: 5, timeout: 2 })).toEqual({ id: 2, ok: true, rowsAffected: 2 });
		expect(mocks.writes[1]).toEqual(expect.objectContaining({
			op: 'query', sqlB64: Buffer.from('select ü').toString('base64'), maxRows: 5, timeout: 2
		}));
		expect(bridge.server).toBe('ms');
		expect(bridge.database).toBe('app');
	});

	it('spawns the Node worker for other dialects and sends the full profile', async () => {
		const bridge = new Bridge('two');
		await bridge.connect(sqlite, 'main');
		expect(mocks.spawn).toHaveBeenCalledWith(process.execPath, [expect.stringContaining('db-worker.mjs')], expect.any(Object));
		expect(mocks.writes[0]).toEqual(expect.objectContaining({ op: 'connect', profile: sqlite, database: 'main' }));
		await bridge.query('select 1');
		expect(mocks.writes[1]).toEqual(expect.objectContaining({ maxRows: 10_000, timeout: 300 }));
	});

	it('rejects failed connects, ignores malformed/unknown output, and reports an unstarted bridge', async () => {
		await expect(new Bridge('idle').query('x')).rejects.toThrow('Bridge not running');
		mocks.response.mockReturnValueOnce({ ok: false, error: 'login denied' });
		await expect(new Bridge('bad').connect(mssql, 'app')).rejects.toThrow('login denied');
		mocks.response.mockReturnValueOnce({ ok: false });
		await expect(new Bridge('bad2').connect(mssql, 'app')).rejects.toThrow('Connect failed');
		mocks.line?.('not json');
		mocks.line?.(JSON.stringify({ id: 999, ok: true }));
	});

	it('logs stderr, rejects pending work on process errors and exits, and can be killed', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const bridge = new Bridge('events');
		await bridge.connect(mssql, 'app');
		mocks.stderr?.({ toString: () => ' warning ' });
		expect(errorSpy).toHaveBeenCalledWith('[bridge events]', 'warning');

		mocks.respond = false;
		const pending = bridge.query('wait');
		await Promise.resolve();
		mocks.events.get('error')?.(new Error('spawn failed'));
		await expect(pending).rejects.toThrow('Failed to start SQL bridge');
		expect(bridge.dead).toBe(true);

		const exited = new Bridge('exit');
		mocks.respond = true;
		await exited.connect(mssql, 'app');
		mocks.respond = false;
		const pendingExit = exited.query('wait');
		await Promise.resolve();
		mocks.events.get('exit')?.();
		await expect(pendingExit).rejects.toThrow('Query cancelled');
		exited.kill();
		expect(mocks.kill).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('times out pending requests and kills the worker', async () => {
		vi.useFakeTimers();
		const bridge = new Bridge('timeout');
		await bridge.connect(mssql, 'app');
		mocks.respond = false;
		const pending = bridge.query('slow', { timeout: 1 });
		const assertion = expect(pending).rejects.toThrow('timed out after 11s');
		await vi.advanceTimersByTimeAsync(11_000);
		await assertion;
		expect(bridge.dead).toBe(true);
		vi.useRealTimers();
	});
});

describe('bridge registry', () => {
	it('validates connections, reuses matching bridges, reconnects databases, and replaces changed engines', async () => {
		mocks.getConnection.mockReturnValueOnce(null);
		await expect(ensureBridge('registry-unknown', 'x', 'd')).rejects.toThrow('Unknown connection');
		const first = await ensureBridge('registry', 'ms', 'one');
		expect(await ensureBridge('registry', 'ms', 'one')).toBe(first);
		await ensureBridge('registry', 'ms', 'two');
		expect(first.database).toBe('two');
		mocks.getConnection.mockReturnValueOnce(sqlite);
		const replaced = await ensureBridge('registry', 'lite', 'main');
		expect(replaced).not.toBe(first);
		expect(first.dead).toBe(true);
	});

	it('kills individual bridges and filtered groups', async () => {
		expect(killBridge('does-not-exist')).toBe(false);
		await ensureBridge('group-a', 'ms', 'a');
		await ensureBridge('group-b', 'ms', 'b');
		const dead = await ensureBridge('group-dead', 'ms', 'a');
		dead.kill();
		expect(killBridgesFor('other')).toBe(0);
		expect(killBridgesFor('ms', 'a')).toBe(1);
		expect(killBridge('group-b')).toBe(true);
		expect(killBridge('group-b')).toBe(false);
	});
});
