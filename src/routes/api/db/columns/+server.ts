import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listColumns, formatType } from '$lib/server/db/meta';

export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	const database = url.searchParams.get('database');
	const schema = url.searchParams.get('schema');
	const table = url.searchParams.get('table');
	if (!server || !database || !schema || !table) {
		return json({ error: 'server, database, schema, table required' }, { status: 400 });
	}
	try {
		const columns = await listColumns(server, database, schema, table);
		return json({
			columns: columns.map((c) => ({ ...c, display: formatType(c) }))
		});
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 502 });
	}
};
