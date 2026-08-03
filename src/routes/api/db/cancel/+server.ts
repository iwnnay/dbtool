import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { killBridge } from '$lib/server/db/bridgeManager';

/**
 * Cancel a sheet's running query by killing its bridge process. The next run
 * transparently respawns and reconnects (temp tables are lost — same trade
 * SSMS makes when you kill a session).
 */
export const POST: RequestHandler = async ({ request }) => {
	const { sheetId } = await request.json();
	if (!sheetId) return json({ error: 'sheetId required' }, { status: 400 });
	return json({ cancelled: killBridge(`sheet:${sheetId}`) });
};
