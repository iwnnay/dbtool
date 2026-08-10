import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadDatamap, jobStatus, startGenerate, checkStale } from '$lib/server/db/datamap';
import { askModelStatus } from '$lib/server/llm/model';

/** Datamap status for a database; ?check=1 also probes schema staleness. */
export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	const database = url.searchParams.get('database');
	if (!server || !database) return json({ error: 'server and database required' }, { status: 400 });

	const map = loadDatamap(server, database);
	const tables = map ? Object.values(map.tables) : [];
	let stale: { stale: number; total: number } | null = null;
	if (url.searchParams.get('check') === '1') {
		try {
			stale = await checkStale(server, database);
		} catch {
			stale = null;
		}
	}
	return json({
		exists: !!map,
		generatedAt: map?.generatedAt ?? null,
		tableCount: tables.length,
		describedCount: tables.filter((t) => t.description).length,
		stale,
		job: jobStatus(server, database),
		ollama: await askModelStatus()
	});
};

/** Kick off (re)generation in the background. */
export const POST: RequestHandler = async ({ request }) => {
	const { server, database, force } = await request.json().catch(() => ({}));
	if (!server || !database) return json({ error: 'server and database required' }, { status: 400 });
	return json({ job: startGenerate(server, database, !!force) });
};
