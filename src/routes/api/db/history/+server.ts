import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearRuns, countRuns, listRuns } from '$lib/server/history';

export const GET: RequestHandler = async ({ url }) => {
	const limit = parseInt(url.searchParams.get('limit') ?? '300', 10);
	const search = url.searchParams.get('q') ?? '';
	try {
		return json({
			entries: listRuns({ limit: Number.isFinite(limit) ? limit : 300, search }),
			total: countRuns()
		});
	} catch (caught) {
		return json({ error: `Could not read query history: ${(caught as Error).message}` }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async () => {
	try {
		return json({ cleared: clearRuns() });
	} catch (caught) {
		return json(
			{ error: `Could not clear query history: ${(caught as Error).message}` },
			{ status: 500 }
		);
	}
};
