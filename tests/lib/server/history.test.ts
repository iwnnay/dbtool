import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	exec: vi.fn(), run: vi.fn(), all: vi.fn(), get: vi.fn(), prepare: vi.fn(), mkdirSync: vi.fn(), construct: vi.fn()
}));
mocks.prepare.mockImplementation((sql: string) => ({
	run: (...args: unknown[]) => mocks.run(sql, ...args),
	all: (...args: unknown[]) => mocks.all(sql, ...args),
	get: (...args: unknown[]) => mocks.get(sql, ...args)
}));
vi.mock('node:fs', () => ({ default: { mkdirSync: mocks.mkdirSync } }));
vi.mock('node:sqlite', () => ({
	DatabaseSync: class {
		constructor(path: string) { mocks.construct(path); return { exec: mocks.exec, prepare: mocks.prepare }; }
	}
}));

import { clearRuns, countRuns, listRuns, recordRun } from '$lib/server/history';

beforeAll(() => vi.clearAllMocks());

describe('query history persistence', () => {
	it('opens and initializes once, then records serialized runs', () => {
		recordRun({ ranAt: 'now', server: 's', database: 'd', sheetId: '1', sheetName: 'Q', sql: 'select 1', ok: true, elapsedMs: 4, rowCount: 1, rowsAffected: 0, error: null, messages: [{ text: 'hi' }] });
		expect(mocks.mkdirSync).toHaveBeenCalledWith(expect.stringMatching(/data$/), { recursive: true });
		expect(mocks.exec).toHaveBeenCalledTimes(2);
		expect(mocks.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'), 'now', 's', 'd', '1', 'Q', 'select 1', 1, 4, 1, 0, null, '[{"text":"hi"}]');
		recordRun({ ranAt: 'later', server: 's', database: 'd', sheetId: '1', sheetName: 'Q', sql: 'bad', ok: false, elapsedMs: 1, rowCount: 0, rowsAffected: 0, error: 'bad', messages: [] });
		expect(mocks.construct).toHaveBeenCalledTimes(1);
	});

	it('swallows write failures so history cannot break query execution', () => {
		mocks.run.mockImplementationOnce(() => { throw new Error('disk full'); });
		expect(() => recordRun({ ranAt: 'x', server: 's', database: 'd', sheetId: '1', sheetName: 'Q', sql: '', ok: false, elapsedMs: 0, rowCount: 0, rowsAffected: 0, error: null, messages: [] })).not.toThrow();
	});

	it('lists mapped entries, escapes searches, and clamps limits', () => {
		mocks.all.mockReturnValueOnce([{
			id: '2', ran_at: 'today', server: 's', database: 'd', sheet_id: '1', sheet_name: 'Q',
			sql: 'select', ok: 1, elapsed_ms: '5', row_count: '2', rows_affected: '1', error: null,
			messages_json: '[{"text":"ok"}]'
		}]);
		expect(listRuns({ limit: 9999, search: '  50%_\\  ' })).toEqual([expect.objectContaining({ id: 2, ok: true, elapsedMs: 5, messages: [{ text: 'ok' }] })]);
		expect(mocks.all).toHaveBeenCalledWith(expect.stringContaining('WHERE sql LIKE'), '%50\\%\\_\\\\%', '%50\\%\\_\\\\%', '%50\\%\\_\\\\%', 2000);

		mocks.all.mockReturnValueOnce([{ id: 3, ran_at: '', server: '', database: '', sheet_id: '', sheet_name: '', sql: '', ok: 0, elapsed_ms: 0, row_count: 0, rows_affected: 0, error: 'x', messages_json: '' }]);
		expect(listRuns({ limit: -4 })[0]).toEqual(expect.objectContaining({ ok: false, error: 'x', messages: [] }));
		expect(mocks.all).toHaveBeenLastCalledWith(expect.not.stringContaining('WHERE sql LIKE'), 1);
	});

	it('counts and clears entries, including an empty count result', () => {
		mocks.get.mockReturnValueOnce({ total: '7' });
		expect(countRuns()).toBe(7);
		mocks.get.mockReturnValueOnce({ total: 3 });
		expect(clearRuns()).toBe(3);
		expect(mocks.exec).toHaveBeenLastCalledWith(expect.stringContaining('DELETE FROM'));
		mocks.get.mockReturnValueOnce(undefined);
		expect(countRuns()).toBe(0);
	});
});
