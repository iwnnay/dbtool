/** Persistent PostgreSQL/SQLite query worker. JSON-lines protocol matches sql-bridge.ps1. */
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';

let engine = null;
let connection = null;
let notices = [];

function send(value) {
	process.stdout.write(JSON.stringify(value, (_key, item) => {
		if (typeof item === 'bigint') return item.toString();
		if (item instanceof Uint8Array) return `0x${Buffer.from(item).toString('hex')}`;
		return item;
	}) + '\n');
}

function postgresType(oid) {
	return ({ 16: 'bool', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 700: 'float4', 701: 'float8',
		1082: 'date', 1114: 'timestamp', 1184: 'timestamptz', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb' })[oid] || `oid:${oid}`;
}

async function closeConnection() {
	if (!connection) return;
	try {
		if (engine === 'postgres') await connection.end();
		else connection.close();
	} catch {}
	connection = null;
}

async function connect(profile, database) {
	await closeConnection();
	engine = profile.type;
	if (engine === 'postgres') {
		const { Client } = await import('pg');
		connection = new Client({
			host: profile.host,
			port: profile.port || 5432,
			user: profile.user || undefined,
			password: profile.password ?? (profile.passwordEnv ? process.env[profile.passwordEnv] : undefined),
			database: database || profile.database || 'postgres',
			ssl: profile.ssl ? { rejectUnauthorized: false } : undefined,
			application_name: 'dbtool',
			connectionTimeoutMillis: 15000
		});
		connection.on('notice', (notice) => notices.push({ text: notice.message, severity: 0, line: 0 }));
		await connection.connect();
		return;
	}
	if (engine === 'sqlite') {
		const { DatabaseSync } = await import('node:sqlite');
		connection = new DatabaseSync(profile.path, { readOnly: !!profile.readOnly });
		connection.exec('PRAGMA foreign_keys = ON');
		return;
	}
	throw new Error(`Unsupported worker engine: ${engine}`);
}

async function queryPostgres(sql, maxRows) {
	notices = [];
	const raw = await connection.query({ text: sql, rowMode: 'array' });
	const results = Array.isArray(raw) ? raw : [raw];
	let affected = 0;
	const resultSets = [];
	for (const result of results) {
		if (!['SELECT', 'SHOW'].includes(result.command)) affected += result.rowCount || 0;
		if (!result.fields?.length) continue;
		const rows = result.rows.slice(0, maxRows);
		resultSets.push({
			columns: result.fields.map((field) => ({ name: field.name, type: postgresType(field.dataTypeID) })),
			rows,
			rowCount: result.rowCount ?? result.rows.length,
			truncated: result.rows.length > maxRows
		});
	}
	return { resultSets, rowsAffected: affected, messages: notices };
}

function querySqlite(sql, maxRows) {
	const statement = connection.prepare(sql);
	const columns = statement.columns();
	if (columns.length) {
		statement.setReturnArrays(true);
		const rows = [];
		let count = 0;
		for (const row of statement.iterate()) {
			count++;
			if (rows.length < maxRows) rows.push(row);
		}
		return {
			resultSets: [{
				columns: columns.map((column) => ({ name: column.name, type: column.type || column.decltype || '' })),
				rows,
				rowCount: count,
				truncated: count > maxRows
			}],
			rowsAffected: 0,
			messages: []
		};
	}
	const result = statement.run();
	return { resultSets: [], rowsAffected: Number(result.changes || 0), messages: [] };
}

const input = createInterface({ input: process.stdin });
input.on('line', async (line) => {
	let request;
	try { request = JSON.parse(line); } catch (error) {
		send({ id: -1, ok: false, error: `Bad request JSON: ${error.message}` });
		return;
	}
	try {
		if (request.op === 'connect') {
			await connect(request.profile, request.database);
			send({ id: request.id, ok: true });
			return;
		}
		if (request.op === 'query') {
			if (!connection) throw new Error('Not connected');
			const sql = Buffer.from(request.sqlB64, 'base64').toString('utf8');
			const started = performance.now();
			const result = engine === 'postgres'
				? await queryPostgres(sql, request.maxRows || 10000)
				: querySqlite(sql, request.maxRows || 10000);
			send({ id: request.id, ok: true, ...result, elapsedMs: Math.round(performance.now() - started) });
			return;
		}
		if (request.op === 'ping') return send({ id: request.id, ok: true });
		throw new Error(`Unknown op: ${request.op}`);
	} catch (error) {
		const position = Number(error.position || 0);
		const source = request.sqlB64 ? Buffer.from(request.sqlB64, 'base64').toString('utf8') : '';
		send({
			id: request.id,
			ok: false,
			error: error.message,
			line: position ? source.slice(0, Math.max(0, position - 1)).split('\n').length : undefined,
			messages: notices
		});
	}
});

process.on('exit', () => { void closeConnection(); });
