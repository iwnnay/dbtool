import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureBridge, type SqlResultSet } from '$lib/server/db/bridgeManager';
import { getSheet, updateSheet } from '$lib/server/store';
import { recordRun } from '$lib/server/history';
import { splitBatches } from '$lib/sql/split';

export interface RunResponse {
	ok: boolean;
	resultSets: SqlResultSet[];
	messages: { text: string; severity?: number; line?: number }[];
	rowsAffected: number;
	elapsedMs: number;
	error?: { text: string; line?: number };
}

/**
 * Execute SQL on the sheet's dedicated connection. `sql` is exactly what the
 * client wants run (whole sheet for run-all, one statement for Ctrl+Enter);
 * we split GO batches here and run them sequentially, stopping on the first
 * failing batch (partial results are still returned). `fullSql`, when present,
 * is the complete sheet text to auto-save.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'invalid JSON body' }, { status: 400 });
	const { sheetId, server, database, sql, fullSql, maxRows } = body as {
		sheetId: string;
		server: string;
		database: string;
		sql: string;
		fullSql?: string;
		maxRows?: number;
	};
	if (!sheetId || !server || !database || sql == null) {
		return json({ error: 'sheetId, server, database, sql required' }, { status: 400 });
	}

	// Auto-save the sheet before running — a crash mid-query loses nothing.
	if (typeof fullSql === 'string') {
		try {
			updateSheet(sheetId, { sql: fullSql, server, database });
		} catch {
			// sheet file missing is not fatal to running the query
		}
	}

	const out: RunResponse = { ok: true, resultSets: [], messages: [], rowsAffected: 0, elapsedMs: 0 };

	const ranAt = new Date().toISOString();
	const log = () =>
		recordRun({
			ranAt,
			server,
			database,
			sheetId,
			sheetName: getSheet(sheetId)?.name ?? '(deleted sheet)',
			sql,
			ok: out.ok,
			elapsedMs: out.elapsedMs,
			rowCount: out.resultSets.reduce((total, resultSet) => total + resultSet.rowCount, 0),
			rowsAffected: out.rowsAffected,
			error: out.error?.text ?? null,
			messages: out.messages
		});

	let bridge;
	try {
		bridge = await ensureBridge(`sheet:${sheetId}`, server, database);
	} catch (e) {
		out.ok = false;
		out.error = { text: `Connection failed: ${(e as Error).message}` };
		log();
		return json(out);
	}

	for (const batch of splitBatches(sql)) {
		// Error line numbers from SQL Server are relative to the batch; shift
		// them so they point into the text the user actually ran.
		const lineOffset = sql.slice(0, batch.start).split('\n').length - 1;
		let res;
		try {
			res = await bridge.query(batch.text, { maxRows });
		} catch (e) {
			out.ok = false;
			out.error = { text: (e as Error).message };
			break;
		}
		out.elapsedMs += res.elapsedMs ?? 0;
		for (const m of res.messages ?? []) {
			out.messages.push({ text: m.text, severity: m.severity, line: (m.line ?? 0) + lineOffset });
		}
		if (!res.ok) {
			out.ok = false;
			out.error = {
				text: res.error ?? 'Query failed',
				line: res.line != null ? res.line + lineOffset : undefined
			};
			break;
		}
		out.resultSets.push(...(res.resultSets ?? []));
		if ((res.rowsAffected ?? -1) > 0) out.rowsAffected += res.rowsAffected!;
	}

	log();
	return json(out);
};
