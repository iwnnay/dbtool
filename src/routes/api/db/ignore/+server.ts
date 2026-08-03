import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadIgnoreList, saveIgnoreList } from '$lib/server/ignore';

export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	const database = url.searchParams.get('database');
	if (!server || !database) return json({ error: 'server and database required' }, { status: 400 });
	return json({ ignored: loadIgnoreList(server, database) });
};

export const PUT: RequestHandler = async ({ request }) => {
	const { server, database, ignored } = await request.json().catch(() => ({}));
	if (!server || !database || !Array.isArray(ignored)) {
		return json({ error: 'server, database, ignored[] required' }, { status: 400 });
	}
	return json({ ignored: saveIgnoreList(server, database, ignored) });
};
