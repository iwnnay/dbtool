import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	flowRun: vi.fn(), bindCancelSignal: vi.fn(), runWithStreamFunnel: vi.fn(),
	loadDatamap: vi.fn(), buildAskContext: vi.fn(), tableDetail: vi.fn(), formatTableContext: vi.fn(),
	askModelStatus: vi.fn(), getConnection: vi.fn()
}));

vi.mock('nacelle-core/server', () => {
	class FlowCancelled extends Error {}
	return {
		FlowCancelled,
		FlowService: class { run(...args: unknown[]) { return mocks.flowRun(...args); } },
		bindCancelSignal: mocks.bindCancelSignal,
		runWithStreamFunnel: mocks.runWithStreamFunnel
	};
});
vi.mock('$lib/server/db/datamap', () => ({ loadDatamap: mocks.loadDatamap, buildAskContext: mocks.buildAskContext }));
vi.mock('$lib/server/db/meta', () => ({ tableDetail: mocks.tableDetail, formatTableContext: mocks.formatTableContext }));
vi.mock('$lib/server/llm/model', () => ({ askModelStatus: mocks.askModelStatus }));
vi.mock('$lib/server/store', () => ({ getConnection: mocks.getConnection }));

import { FlowCancelled } from 'nacelle-core/server';
import { GET, POST } from '../../src/routes/api/db/ask/+server';

const request = (body: unknown, raw = false) => ({
	request: new Request('http://test/api/db/ask', {
		method: 'POST', body: raw ? String(body) : JSON.stringify(body),
		headers: { 'content-type': 'application/json' }
	})
}) as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.askModelStatus.mockResolvedValue({ ok: true, model: 'test' });
	mocks.getConnection.mockReturnValue({ id: 's', name: 'S', type: 'postgres' });
	mocks.loadDatamap.mockReturnValue({ tables: { 'public.people': { description: 'People' } } });
	mocks.buildAskContext.mockReturnValue('database context');
	mocks.tableDetail.mockResolvedValue({ schema: 'public', name: 'people' });
	mocks.formatTableContext.mockReturnValue('table context');
	mocks.flowRun.mockResolvedValue({ result: 'answer' });
	mocks.runWithStreamFunnel.mockImplementation(async (enqueue, run) => {
		enqueue('streamed answer');
		return run();
	});
	mocks.bindCancelSignal.mockImplementation((_signal, run) => run());
});

describe('Ask endpoint', () => {
	it('reports model status and validates request bodies', async () => {
		expect(await (await GET({} as never)).json()).toEqual({ ollama: { ok: true, model: 'test' } });
		expect((await POST(request('{bad', true))).status).toBe(400);
		expect((await POST(request({ messages: 'not an array' }))).status).toBe(400);
	});

	it('runs a general flow, removes system messages, limits history, and streams output', async () => {
		const messages = [
			{ role: 'system', content: 'secret' },
			...Array.from({ length: 22 }, (_, i) => ({ role: i === 21 ? 'user' : 'assistant', content: `m${i}` }))
		];
		const response = await POST(request({ scope: 'general', messages }));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/plain');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.text()).toBe('streamed answer');
		expect(mocks.flowRun).toHaveBeenCalledWith('ask_general_flow', expect.objectContaining({
			user_query: 'm21', history: expect.any(Array)
		}));
		expect(mocks.flowRun.mock.calls[0][1].history).toHaveLength(20);
	});

	it('builds database context for each dialect and rejects missing inputs', async () => {
		const base = { scope: 'database', messages: [{ role: 'user', content: 'question' }] };
		let response = await POST(request(base));
		expect(response.status).toBe(409);
		expect(await response.text()).toContain('server and database are required');

		mocks.getConnection.mockReturnValueOnce(null);
		response = await POST(request({ ...base, server: 'missing', database: 'd' }));
		expect(await response.text()).toContain('Unknown connection');

		mocks.loadDatamap.mockReturnValueOnce(null);
		response = await POST(request({ ...base, server: 's', database: 'd' }));
		expect(await response.text()).toContain('No datamap');

		for (const profile of [
			{ id: 's', name: 'MS', type: 'mssql', server: '.' },
			{ id: 's', name: 'PG', type: 'postgres', host: 'x', port: 1, user: 'u' },
			{ id: 's', name: 'Lite', type: 'sqlite', path: 'x' }
		]) {
			mocks.getConnection.mockReturnValueOnce(profile);
			response = await POST(request({ ...base, server: 's', database: 'd' }));
			await response.text();
		}
		expect(mocks.flowRun.mock.calls.slice(-3).map((call) => call[1].dialect)).toEqual([
			'Microsoft SQL Server T-SQL', 'PostgreSQL', 'SQLite'
		]);
		expect(mocks.buildAskContext).toHaveBeenCalledWith(expect.any(Object), 'question');
	});

	it('builds table context with an optional stored description and validates table names', async () => {
		const base = { scope: 'table', server: 's', database: 'd', messages: [{ role: 'assistant', content: 'no user' }] };
		let response = await POST(request(base));
		expect(response.status).toBe(409);
		expect(await response.text()).toContain('schema and table are required');

		response = await POST(request({ ...base, schema: 'public', table: 'people' }));
		expect(await response.text()).toBe('streamed answer');
		expect(mocks.formatTableContext).toHaveBeenCalledWith('s', 'd', { schema: 'public', name: 'people' }, 'People');
		expect(mocks.flowRun).toHaveBeenCalledWith('ask_table_flow', expect.objectContaining({
			table: 'public.people', context: 'table context', user_query: ''
		}));

		mocks.loadDatamap.mockReturnValueOnce(null);
		response = await POST(request({ ...base, schema: 'public', table: 'people' }));
		await response.text();
		expect(mocks.formatTableContext).toHaveBeenLastCalledWith('s', 'd', expect.anything(), undefined);
	});

	it('renders stream failures but suppresses expected cancellation', async () => {
		mocks.bindCancelSignal.mockRejectedValueOnce(new Error('model offline'));
		let response = await POST(request({ scope: 'general', messages: [] }));
		expect(await response.text()).toBe('\n\n[error: model offline]');

		mocks.bindCancelSignal.mockRejectedValueOnce(new FlowCancelled('cancelled'));
		response = await POST(request({ scope: 'general', messages: [] }));
		expect(await response.text()).toBe('');
	});
});
