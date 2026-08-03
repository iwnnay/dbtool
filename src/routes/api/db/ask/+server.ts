import type { RequestHandler } from './$types';
import { chatStream, type ChatMessage } from '$lib/server/ollama';
import { loadDatamap, buildAskContext } from '$lib/server/db/datamap';

const SYSTEM = (ctx: string, database: string) =>
	`You are a SQL Server expert writing queries against the ${database} database. The catalog below lists its real tables and columns.

Rules:
- Only reference tables and columns that exist in the catalog. If something needed is not there, say so instead of inventing it.
- Schema-qualify names (dbo.Table). Use COUNT_BIG(*) for counts.
- When asked for a query, give runnable T-SQL in a \`\`\`sql block and briefly explain the joins.
- Prefer the smallest set of tables that answers the question. Be concise.

=== SCHEMA CONTEXT ===
${ctx}
=== END SCHEMA CONTEXT ===`;

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		server: string;
		database: string;
		messages: ChatMessage[];
	} | null;
	if (!body?.server || !body?.database || !Array.isArray(body.messages)) {
		return new Response('server, database, messages required', { status: 400 });
	}

	const map = loadDatamap(body.server, body.database);
	if (!map) {
		return new Response('No datamap for this database yet — build it first.', { status: 409 });
	}

	const history = body.messages.filter((m) => m.role !== 'system').slice(-20);
	const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM(buildAskContext(map, lastUser), body.database) },
		...history
	];

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const enc = new TextEncoder();
			try {
				for await (const delta of chatStream(messages)) {
					controller.enqueue(enc.encode(delta));
				}
			} catch (e) {
				controller.enqueue(enc.encode(`\n\n[error: ${(e as Error).message}]`));
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
};
