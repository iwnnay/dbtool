import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(), resolveModel: vi.fn(), resolveProvider: vi.fn(), list: vi.fn(), buildClient: vi.fn()
}));
vi.mock('nacelle-core/server', () => ({
	BaseFlow: class {},
	node: (_name: string, fn: unknown) => fn,
	invokeTaskModelStream: mocks.invoke,
	resolveModelForAlias: mocks.resolveModel,
	resolveProviderName: mocks.resolveProvider,
	buildClient: mocks.buildClient
}));

import { answerWithTask, redactContext } from '$lib/server/llm/askNode';
import { askModelStatus } from '$lib/server/llm/model';
import { DescribeTablesFlow } from '$lib/server/flows/describeTablesFlow';
import { currentTime } from '$lib/server/tools/currentTime';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.invoke.mockResolvedValue({ content: 'answer' });
	mocks.resolveModel.mockReturnValue('gpt-test');
	mocks.resolveProvider.mockReturnValue('openai');
	mocks.buildClient.mockReturnValue({ models: { list: mocks.list.mockResolvedValue([]) } });
});

describe('LLM helpers and tools', () => {
	it('invokes an ask task with state history and normalized user input', async () => {
		expect(await answerWithTask('answer_database', { context: 'ctx' }, { user_query: 42, history: [{ role: 'user', content: 'hi' }] })).toEqual({ result: 'answer' });
		expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({
			alias: 'ask', taskName: 'answer_database', taskAgent: 'sql_expert',
			variables: { context: 'ctx', user_query: '42' }, options: { temperature: 0.2 }
		}));
	});

	it('redacts populated and empty schema context', () => {
		expect(redactContext({ context: '12345', other: true })).toEqual({ context: '[5 chars of schema context]', other: true });
		expect(redactContext({})).toEqual({ context: '' });
	});

	it('checks model availability and retains resolution context on failure', async () => {
		expect(await askModelStatus()).toEqual({ ok: true, model: 'gpt-test' });
		mocks.list.mockRejectedValueOnce(new Error('offline'));
		expect(await askModelStatus()).toEqual({ ok: false, model: 'gpt-test', error: 'offline' });
		mocks.resolveModel.mockImplementationOnce(() => { throw new Error('unconfigured'); });
		expect(await askModelStatus()).toEqual({ ok: false, model: '(unresolved)', error: 'unconfigured' });
	});

	it('describes table batches and redacts serialized listings', async () => {
		const flow = new DescribeTablesFlow() as DescribeTablesFlow & { serializeState(state: object): unknown };
		expect(flow.serializeState({ tables: 'abc', other: 1 })).toEqual({ tables: '[3 chars of table listing]', other: 1 });
		expect(flow.serializeState({})).toEqual({ tables: '' });
		expect(await flow.describe({ tables: 'dbo.people' })).toEqual({ result: 'answer' });
		expect(mocks.invoke).toHaveBeenLastCalledWith(expect.objectContaining({
			taskName: 'describe_tables', taskAgent: 'schema_cataloguer', options: { temperature: 0.15 }
		}));
	});

	it('returns an ISO timestamp from the default tool', async () => {
		const value = await currentTime.execute({});
		expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});
