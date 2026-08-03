import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDatabases } from '$lib/server/db/meta';

export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	if (!server) return json({ error: 'server required' }, { status: 400 });
	try {
		return json({ databases: await listDatabases(server) });
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 502 });
	}
};
