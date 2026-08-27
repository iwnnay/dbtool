import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	ensureBridge: vi.fn(), getSheet: vi.fn(), updateSheet: vi.fn(), recordRun: vi.fn(), getConnection: vi.fn(), query: vi.fn()
}));
vi.mock('$lib/server/db/bridgeManager', () => ({ ensureBridge: mocks.ensureBridge }));
vi.mock('$lib/server/store', () => ({
	getSheet: mocks.getSheet, updateSheet: mocks.updateSheet, getConnection: mocks.getConnection
}));
vi.mock('$lib/server/history', () => ({ recordRun: mocks.recordRun }));

import { POST } from '../../src/routes/api/db/run/+server';

const request = (body: unknown, raw = false) => ({
	request: new Request('http://test/api/db/run', {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: raw ? String(body) : JSON.stringify(body)
	})
}) as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ensureBridge.mockResolvedValue({ query: mocks.query });
	mocks.getSheet.mockReturnValue({ name: 'Query 1' });
	mocks.getConnection.mockReturnValue({ id: 's', name: 'S', type: 'postgres' });
});

describe('query execution endpoint', () => {
	it('validates JSON, required fields, and known connections', async () => {
		expect((await POST(request('{bad', true))).status).toBe(400);
		for (const body of [{}, { sheetId: '1', server: 's', database: 'd' }]) {
			expect((await POST(request(body))).status).toBe(400);
		}
		mocks.getConnection.mockReturnValueOnce(null);
		const response = await POST(request({ sheetId: '1', server: 'missing', database: 'd', sql: '' }));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Unknown connection: missing' });
	});

	it('runs PostgreSQL, auto-saves, aggregates results and records history', async () => {
		mocks.query.mockResolvedValueOnce({
			ok: true, elapsedMs: 12, rowsAffected: 3,
			messages: [{ text: 'notice', severity: 1, line: 2 }],
			resultSets: [{ columns: [{ name: 'id', type: 'int' }], rows: [[1]], rowCount: 1, truncated: false }]
		});
		const response = await POST(request({ sheetId: '1', server: 's', database: 'd', sql: 'select 1', fullSql: 'select 1;', maxRows: 10 }));
		const body = await response.json();
		expect(body).toEqual(expect.objectContaining({ ok: true, elapsedMs: 12, rowsAffected: 3 }));
		expect(body.resultSets[0].sourceSql).toBe('select 1');
		expect(mocks.updateSheet).toHaveBeenCalledWith('1', { sql: 'select 1;', server: 's', database: 'd' });
		expect(mocks.query).toHaveBeenCalledWith('select 1', { maxRows: 10 });
		expect(mocks.recordRun).toHaveBeenCalledWith(expect.objectContaining({ sheetName: 'Query 1', rowCount: 1, ok: true }));
	});

	it('runs SQL Server GO batches, shifts line numbers, and stops after a failed batch', async () => {
		mocks.getConnection.mockReturnValue({ id: 's', name: 'S', type: 'mssql', server: '.' });
		mocks.query
			.mockResolvedValueOnce({ ok: true, elapsedMs: 2, rowsAffected: 0, messages: [{ text: 'first', line: 1 }], resultSets: [] })
			.mockResolvedValueOnce({ ok: false, elapsedMs: 3, rowsAffected: 5, error: 'bad sql', line: 2, messages: [{ text: 'second', line: 1 }] });
		const response = await POST(request({ sheetId: '1', server: 's', database: 'd', sql: 'select 1\nGO\nselect bad' }));
		const body = await response.json();
		expect(body.ok).toBe(false);
		expect(body.elapsedMs).toBe(5);
		expect(body.error).toEqual({ text: 'bad sql', line: 4 });
		expect(body.messages.map((message: { line: number }) => message.line)).toEqual([1, 3]);
		expect(mocks.recordRun).toHaveBeenCalledWith(expect.objectContaining({ error: 'bad sql', ok: false }));
	});

	it('runs individual SQLite statements and handles thrown query errors', async () => {
		mocks.getConnection.mockReturnValue({ id: 's', name: 'Lite', type: 'sqlite', path: 'x' });
		mocks.getSheet.mockReturnValue(null);
		mocks.updateSheet.mockImplementationOnce(() => { throw new Error('missing sheet'); });
		mocks.query.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('bridge died'));
		const body = await (await POST(request({ sheetId: '1', server: 's', database: 'd', sql: 'select 1; select 2;', fullSql: 'all' }))).json();
		expect(body).toEqual(expect.objectContaining({ ok: false, error: { text: 'bridge died' } }));
		expect(mocks.query).toHaveBeenCalledTimes(2);
		expect(mocks.recordRun).toHaveBeenCalledWith(expect.objectContaining({ sheetName: '(deleted sheet)' }));
	});

	it('returns and logs connection failures without querying', async () => {
		mocks.ensureBridge.mockRejectedValueOnce(new Error('login failed'));
		const body = await (await POST(request({ sheetId: '1', server: 's', database: 'd', sql: 'select 1' }))).json();
		expect(body).toEqual(expect.objectContaining({ ok: false, error: { text: 'Connection failed: login failed' } }));
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.recordRun).toHaveBeenCalled();
	});

	it('supplies fallback query errors and ignores non-positive affected counts', async () => {
		mocks.query.mockResolvedValueOnce({ ok: false, rowsAffected: -1 });
		const body = await (await POST(request({ sheetId: '1', server: 's', database: 'd', sql: '' }))).json();
		expect(body.error).toEqual({ text: 'Query failed' });
		expect(body.rowsAffected).toBe(0);
	});
});
