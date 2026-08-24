import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listConnections, addConnection, addSqlServer, removeConnection } from '$lib/server/store';
import type { ConnectionProfileInput } from '$lib/db/types';

export const GET: RequestHandler = async () => json({ connections: listConnections() });

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	// Keep accepting the original {name} request for old clients.
	if (body.type == null && typeof body.name === 'string' && body.name.trim()) {
		return json({ connections: addSqlServer(body.name.trim()) });
	}
	if (!body.name || !['mssql', 'postgres', 'sqlite'].includes(body.type)) {
		return json({ error: 'name and valid type required' }, { status: 400 });
	}
	if (body.type === 'mssql' && !body.server) return json({ error: 'server required' }, { status: 400 });
	if (body.type === 'postgres' && !body.host) return json({ error: 'host required' }, { status: 400 });
	if (body.type === 'sqlite' && !body.path) return json({ error: 'path required' }, { status: 400 });
	try {
		return json({ connections: addConnection(body as ConnectionProfileInput) });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id') ?? url.searchParams.get('name');
	if (!id) return json({ error: 'id required' }, { status: 400 });
	return json({ connections: removeConnection(id) });
};
