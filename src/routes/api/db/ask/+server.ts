import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FlowService, FlowCancelled, bindCancelSignal, runWithStreamFunnel } from 'nacelle-core/server';
import { loadDatamap, buildAskContext } from '$lib/server/db/datamap';
import { tableDetail, formatTableContext } from '$lib/server/db/meta';
import { askModelStatus } from '$lib/server/llm/model';
import { getConnection } from '$lib/server/store';

export type AskScope = 'general' | 'database' | 'table';

interface AskMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

const FLOW_BY_SCOPE: Record<AskScope, string> = {
	general: 'ask_general_flow',
	database: 'ask_database_flow',
	table: 'ask_table_flow'
};

interface AskBody {
	scope?: AskScope;
	server?: string;
	database?: string;
	schema?: string;
	table?: string;
	messages: AskMessage[];
}

export const GET: RequestHandler = async () => json({ ollama: await askModelStatus() });

interface AskRun {
	flowName: string;
	inputs: Record<string, unknown>;
}

async function resolveRun(body: AskBody): Promise<AskRun> {
	const scope = body.scope ?? 'database';
	const flowName = FLOW_BY_SCOPE[scope];
	const history = body.messages.filter((message) => message.role !== 'system').slice(-20);
	const userQuery =
		[...history].reverse().find((message) => message.role === 'user')?.content ?? '';
	const base = { user_query: userQuery, history };

	if (scope === 'general') return { flowName, inputs: base };

	if (!body.server || !body.database) {
		throw new Error(`server and database are required for a ${scope}-scoped ask`);
	}
	const profile = getConnection(body.server);
	if (!profile) throw new Error(`Unknown connection: ${body.server}`);
	const dialect = profile.type === 'mssql'
		? 'Microsoft SQL Server T-SQL'
		: profile.type === 'postgres' ? 'PostgreSQL' : 'SQLite';

	if (scope === 'table') {
		if (!body.schema || !body.table) {
			throw new Error('schema and table are required for a table-scoped ask');
		}
		const detail = await tableDetail(body.server, body.database, body.schema, body.table);
		const description = loadDatamap(body.server, body.database)?.tables[
			`${body.schema}.${body.table}`
		]?.description;
		return {
			flowName,
			inputs: {
				...base,
				dialect,
				database: body.database,
				table: `${detail.schema}.${detail.name}`,
				context: formatTableContext(body.server, body.database, detail, description)
			}
		};
	}

	const map = loadDatamap(body.server, body.database);
	if (!map) {
		throw new Error(
			`No datamap for ${body.database} on ${body.server} yet — build it first from the database's Ask window`
		);
	}
	return {
		flowName,
		inputs: {
			...base,
			dialect,
			database: body.database,
			context: buildAskContext(map, userQuery)
		}
	};
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as AskBody | null;
	if (!body || !Array.isArray(body.messages)) {
		return new Response('messages required', { status: 400 });
	}

	let run: AskRun;
	try {
		run = await resolveRun(body);
	} catch (caught) {
		return new Response((caught as Error).message, { status: 409 });
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			const enqueue = (text: string) => {
				if (!closed) controller.enqueue(encoder.encode(text));
			};
			try {
				await bindCancelSignal(request.signal, () =>
					runWithStreamFunnel(enqueue, () => new FlowService().run(run.flowName, run.inputs))
				);
			} catch (caught) {
				if (!(caught instanceof FlowCancelled)) {
					enqueue(`\n\n[error: ${(caught as Error).message}]`);
				}
			} finally {
				closed = true;
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
};
