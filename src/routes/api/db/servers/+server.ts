import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listServers, addServer, removeServer } from '$lib/server/store';

export const GET: RequestHandler = async () => json({ servers: listServers() });

export const POST: RequestHandler = async ({ request }) => {
	const { name } = await request.json();
	if (!name || typeof name !== 'string') return json({ error: 'name required' }, { status: 400 });
	return json({ servers: addServer(name.trim()) });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const name = url.searchParams.get('name');
	if (!name) return json({ error: 'name required' }, { status: 400 });
	return json({ servers: removeServer(name) });
};
