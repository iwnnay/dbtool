import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dbProperties } from '$lib/server/db/meta';

export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	const database = url.searchParams.get('database');
	if (!server || !database) return json({ error: 'server and database required' }, { status: 400 });
	try {
		return json({ properties: await dbProperties(server, database) });
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 502 });
	}
};
