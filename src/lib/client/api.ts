/** Thin typed fetch wrappers over the /api/db and /api/sheets endpoints. */

export interface SqlColumn {
	name: string;
	type: string;
}

export interface SqlResultSet {
	columns: SqlColumn[];
	rows: unknown[][];
	rowCount: number;
	truncated: boolean;
}

export interface RunResponse {
	ok: boolean;
	resultSets: SqlResultSet[];
	messages: { text: string; severity?: number; line?: number }[];
	rowsAffected: number;
	elapsedMs: number;
	error?: { text: string; line?: number };
}

export interface Sheet {
	id: string;
	name: string;
	server: string;
	database: string;
	sql: string;
	position: number;
	createdAt: string;
	updatedAt: string;
}

export interface DatabaseInfo {
	name: string;
	isSystem: boolean;
}

export interface DbObject {
	schema: string;
	name: string;
	type: 'table' | 'view' | 'procedure';
}

export interface ColumnInfo {
	name: string;
	type: string;
	display: string;
	maxLength: number;
	precision: number;
	scale: number;
	nullable: boolean;
	identity: boolean;
	computed: boolean;
	isPk: boolean;
}

export interface DatamapJob {
	running: boolean;
	phase: 'snapshot' | 'describe' | 'done' | 'error';
	done: number;
	total: number;
	error?: string;
}

export interface DatamapStatus {
	exists: boolean;
	generatedAt: string | null;
	tableCount: number;
	describedCount: number;
	stale: { stale: number; total: number } | null;
	job: DatamapJob | null;
	ollama: { ok: boolean; model: string; error?: string };
}

export interface DbProperties {
	name: string;
	owner: string | null;
	collation: string | null;
	createDate: string;
	compatibilityLevel: number;
	recoveryModel: string;
	state: string;
	userConnections: number | null;
	dataMb: number | null;
	logMb: number | null;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		headers: { 'content-type': 'application/json' },
		...init
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
	return body as T;
}

export const api = {
	servers: () => req<{ servers: string[] }>('/api/db/servers'),
	addServer: (name: string) =>
		req<{ servers: string[] }>('/api/db/servers', { method: 'POST', body: JSON.stringify({ name }) }),
	removeServer: (name: string) =>
		req<{ servers: string[] }>(`/api/db/servers?name=${encodeURIComponent(name)}`, {
			method: 'DELETE'
		}),
	databases: (server: string) =>
		req<{ databases: DatabaseInfo[] }>(`/api/db/databases?server=${encodeURIComponent(server)}`),
	objects: (server: string, database: string, all = false) =>
		req<{ objects: DbObject[] }>(
			`/api/db/objects?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}${all ? '&all=1' : ''}`
		),
	columnSearch: (server: string, database: string, q: string) =>
		req<{ columns: { name: string; count: number; example: string; type: string }[] }>(
			`/api/db/columnsearch?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}&q=${encodeURIComponent(q)}`
		),
	getIgnore: (server: string, database: string) =>
		req<{ ignored: string[] }>(
			`/api/db/ignore?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}`
		),
	saveIgnore: (server: string, database: string, ignored: string[]) =>
		req<{ ignored: string[] }>('/api/db/ignore', {
			method: 'PUT',
			body: JSON.stringify({ server, database, ignored })
		}),
	definition: (server: string, database: string, schema: string, name: string) =>
		req<{ definition: string }>(
			`/api/db/definition?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(name)}`
		),
	columns: (server: string, database: string, schema: string, table: string) =>
		req<{ columns: ColumnInfo[] }>(
			`/api/db/columns?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`
		),
	datamapStatus: (server: string, database: string, check = false) =>
		req<DatamapStatus>(
			`/api/db/datamap?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}${check ? '&check=1' : ''}`
		),
	datamapGenerate: (server: string, database: string, force = false) =>
		req<{ job: DatamapJob }>('/api/db/datamap', {
			method: 'POST',
			body: JSON.stringify({ server, database, force })
		}),
	properties: (server: string, database: string) =>
		req<{ properties: DbProperties }>(
			`/api/db/properties?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}`
		),
	run: (body: {
		sheetId: string;
		server: string;
		database: string;
		sql: string;
		fullSql?: string;
		maxRows?: number;
	}) => req<RunResponse>('/api/db/run', { method: 'POST', body: JSON.stringify(body) }),
	disconnect: (server: string, database?: string) =>
		req<{ closed: number }>('/api/db/disconnect', {
			method: 'POST',
			body: JSON.stringify({ server, database })
		}),
	cancel: (sheetId: string) =>
		req<{ cancelled: boolean }>('/api/db/cancel', {
			method: 'POST',
			body: JSON.stringify({ sheetId })
		}),
	sheets: () => req<{ sheets: Sheet[] }>('/api/sheets'),
	createSheet: (partial: Partial<Sheet>) =>
		req<{ sheet: Sheet }>('/api/sheets', { method: 'POST', body: JSON.stringify(partial) }),
	updateSheet: (id: string, patch: Partial<Sheet>) =>
		req<{ sheet: Sheet }>(`/api/sheets/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
	deleteSheet: (id: string) => req<{ ok: boolean }>(`/api/sheets/${id}`, { method: 'DELETE' })
};
