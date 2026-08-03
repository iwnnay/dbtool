import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { killBridgesFor } from '$lib/server/db/bridgeManager';

export const POST: RequestHandler = async ({ request }) => {
	const { server, database } = await request.json().catch(() => ({}));
	if (!server) return json({ error: 'server required' }, { status: 400 });
	return json({ closed: killBridgesFor(server, database || undefined) });
};
