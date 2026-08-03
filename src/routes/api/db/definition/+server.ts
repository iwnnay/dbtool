import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { objectDefinition } from '$lib/server/db/meta';

export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	const database = url.searchParams.get('database');
	const schema = url.searchParams.get('schema');
	const name = url.searchParams.get('name');
	if (!server || !database || !schema || !name) {
		return json({ error: 'server, database, schema and name required' }, { status: 400 });
	}
	try {
		return json({ definition: await objectDefinition(server, database, schema, name) });
	} catch (caught) {
		return json({ error: (caught as Error).message }, { status: 502 });
	}
};
