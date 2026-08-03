import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateSheet, deleteSheet } from '$lib/server/store';
import { killBridge } from '$lib/server/db/bridgeManager';

export const PUT: RequestHandler = async ({ params, request }) => {
	const patch = await request.json();
	try {
		return json({ sheet: updateSheet(params.id, patch) });
	} catch {
		return json({ error: 'sheet not found' }, { status: 404 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	deleteSheet(params.id);
	killBridge(`sheet:${params.id}`);
	return json({ ok: true });
};
