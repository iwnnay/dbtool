import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchColumns } from '$lib/server/db/meta';

export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	const database = url.searchParams.get('database');
	const q = url.searchParams.get('q') ?? '';
	if (!server || !database) return json({ error: 'server and database required' }, { status: 400 });
	try {
		return json({ columns: await searchColumns(server, database, q) });
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 502 });
	}
};
