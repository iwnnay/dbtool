import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listObjects } from '$lib/server/db/meta';
import { ignoreSet, isIgnored } from '$lib/server/ignore';

/** Objects minus the ignore list; ?all=1 bypasses it (ignore-list editor). */
export const GET: RequestHandler = async ({ url }) => {
	const server = url.searchParams.get('server');
	const database = url.searchParams.get('database');
	if (!server || !database) return json({ error: 'server and database required' }, { status: 400 });
	try {
		let objects = await listObjects(server, database);
		if (url.searchParams.get('all') !== '1') {
			const ignored = ignoreSet(server, database);
			if (ignored.size > 0) objects = objects.filter((o) => !isIgnored(ignored, o.schema, o.name));
		}
		return json({ objects });
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 502 });
	}
};
