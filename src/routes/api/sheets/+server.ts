import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSheets, createSheet } from '$lib/server/store';

export const GET: RequestHandler = async () => json({ sheets: listSheets() });

export const POST: RequestHandler = async ({ request }) => {
	const partial = await request.json().catch(() => ({}));
	return json({ sheet: createSheet(partial) });
};
