/**
 * Catalog metadata queries (databases / schemas / tables / columns) for the
 * explorer tree. All run through one shared bridge per server (`meta:<server>`)
 * connected to master, using cross-database `[db].sys.*` queries so we never
 * have to switch databases.
 */
import { ensureBridge, type QueryResult } from './bridgeManager';
import { ignoreSet, isIgnored } from '../ignore';

function bracket(name: string): string {
	return `[${name.replace(/]/g, ']]')}]`;
}

function quote(name: string): string {
	return `'${name.replace(/'/g, "''")}'`;
}

async function metaQuery(server: string, sql: string): Promise<QueryResult> {
	const bridge = await ensureBridge(`meta:${server}`, server, 'master');
	const res = await bridge.query(sql, { maxRows: 50_000, timeout: 60 });
	if (!res.ok) throw new Error(res.error ?? 'Metadata query failed');
	return res;
}

export interface DatabaseInfo {
	name: string;
	isSystem: boolean;
}

export async function listDatabases(server: string): Promise<DatabaseInfo[]> {
	const res = await metaQuery(
		server,
		`SELECT name, CASE WHEN database_id <= 4 THEN 1 ELSE 0 END AS is_system
		 FROM sys.databases WHERE state = 0 ORDER BY name`
	);
	const rows = res.resultSets?.[0]?.rows ?? [];
	return rows.map((r) => ({ name: String(r[0]), isSystem: r[1] === 1 }));
}

export interface DbObject {
	schema: string;
	name: string;
	type: 'table' | 'view' | 'procedure';
}

const OBJECT_TYPES: Record<string, DbObject['type']> = { U: 'table', V: 'view', P: 'procedure' };

export async function listObjects(server: string, database: string): Promise<DbObject[]> {
	const db = bracket(database);
	const res = await metaQuery(
		server,
		`SELECT s.name, o.name, o.type
		 FROM ${db}.sys.objects o
		 JOIN ${db}.sys.schemas s ON o.schema_id = s.schema_id
		 WHERE o.type IN ('U', 'V', 'P')
		 ORDER BY s.name, CASE WHEN o.type = 'P' THEN 1 ELSE 0 END, o.name`
	);
	const rows = res.resultSets?.[0]?.rows ?? [];
	return rows.map((r) => ({
		schema: String(r[0]),
		name: String(r[1]),
		type: OBJECT_TYPES[String(r[2]).trim()] ?? 'table'
	}));
}

/** T-SQL source of a module (procedure/view/function) via sys.sql_modules. */
export async function objectDefinition(
	server: string,
	database: string,
	schema: string,
	name: string
): Promise<string> {
	const db = bracket(database);
	const res = await metaQuery(
		server,
		`SELECT modules.definition
		 FROM ${db}.sys.sql_modules AS modules
		 JOIN ${db}.sys.objects AS objects ON objects.object_id = modules.object_id
		 JOIN ${db}.sys.schemas AS schemas ON schemas.schema_id = objects.schema_id
		 WHERE schemas.name = ${quote(schema)} AND objects.name = ${quote(name)}`
	);
	const definition = res.resultSets?.[0]?.rows?.[0]?.[0];
	if (definition == null) {
		throw new Error(
			`No definition found for ${schema}.${name} in ${database} — the object does not exist, is not a SQL module, or was created WITH ENCRYPTION`
		);
	}
	return String(definition);
}

export interface ColumnInfo {
	name: string;
	type: string;
	maxLength: number;
	precision: number;
	scale: number;
	nullable: boolean;
	identity: boolean;
	computed: boolean;
	isPk: boolean;
}

export async function listColumns(
	server: string,
	database: string,
	schema: string,
	table: string
): Promise<ColumnInfo[]> {
	const db = bracket(database);
	const objectId = `OBJECT_ID(${quote(`${bracket(database)}.${bracket(schema)}.${bracket(table)}`)})`;
	const res = await metaQuery(
		server,
		`SELECT c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
		        c.is_computed, CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END
		 FROM ${db}.sys.columns c
		 JOIN ${db}.sys.types t ON c.user_type_id = t.user_type_id
		 LEFT JOIN (
		   SELECT ic.object_id, ic.column_id
		   FROM ${db}.sys.index_columns ic
		   JOIN ${db}.sys.indexes i
		     ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND i.is_primary_key = 1
		 ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
		 WHERE c.object_id = ${objectId}
		 ORDER BY c.column_id`
	);
	const rows = res.resultSets?.[0]?.rows ?? [];
	return rows.map((r) => ({
		name: String(r[0]),
		type: String(r[1]),
		maxLength: Number(r[2]),
		precision: Number(r[3]),
		scale: Number(r[4]),
		nullable: r[5] === true,
		identity: r[6] === true,
		computed: r[7] === true,
		isPk: r[8] === 1
	}));
}

export interface ColumnSearchHit {
	name: string;
	count: number;
	example: string;
	type: string;
}

/**
 * Prefix-search column names across every table/view in a database (the
 * no-FROM autocomplete fallback). One catalog query, grouped client-side so
 * `person_id` appearing in 300 tables is one suggestion.
 */
export async function searchColumns(
	server: string,
	database: string,
	prefix: string
): Promise<ColumnSearchHit[]> {
	const db = bracket(database);
	const like = prefix.replace(/[\\%_[]/g, (c) => `\\${c}`).replace(/'/g, "''");
	const res = await metaQuery(
		server,
		`SELECT TOP (800) s.name, o.name, c.name, ty.name
		 FROM ${db}.sys.columns c
		 JOIN ${db}.sys.objects o ON o.object_id = c.object_id AND o.type IN ('U', 'V')
		 JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id
		 JOIN ${db}.sys.types ty ON ty.user_type_id = c.user_type_id
		 WHERE c.name LIKE '${like}%' ESCAPE '\\'
		 ORDER BY c.name, s.name, o.name`
	);
	const rows = res.resultSets?.[0]?.rows ?? [];
	const ignored = ignoreSet(server, database);
	const byName = new Map<string, ColumnSearchHit & { _schemaTables: Set<string> }>();
	for (const r of rows) {
		const [schema, table, col, type] = [String(r[0]), String(r[1]), String(r[2]), String(r[3])];
		if (isIgnored(ignored, schema, table)) continue;
		let hit = byName.get(col);
		if (!hit) {
			hit = { name: col, count: 0, example: `${schema}.${table}`, type, _schemaTables: new Set() };
			byName.set(col, hit);
		}
		hit._schemaTables.add(`${schema}.${table}`);
		hit.count = hit._schemaTables.size;
	}
	return [...byName.values()]
		.slice(0, 200)
		.map(({ _schemaTables, ...hit }) => hit);
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

export async function dbProperties(server: string, database: string): Promise<DbProperties> {
	const db = bracket(database);
	const res = await metaQuery(
		server,
		`SELECT d.name, SUSER_SNAME(d.owner_sid), d.collation_name, d.create_date,
		        d.compatibility_level, d.recovery_model_desc, d.state_desc,
		        (SELECT COUNT(*) FROM sys.dm_exec_sessions s
		         WHERE s.database_id = d.database_id AND s.is_user_process = 1)
		 FROM sys.databases d WHERE d.name = ${quote(database)};
		 SELECT f.type_desc, CAST(SUM(CAST(f.size AS bigint)) * 8.0 / 1024 AS decimal(18,2))
		 FROM ${db}.sys.database_files f GROUP BY f.type_desc`
	);
	const props = res.resultSets?.[0]?.rows?.[0];
	if (!props) throw new Error(`Database not found: ${database}`);
	const files = res.resultSets?.[1]?.rows ?? [];
	const sizeOf = (type: string) => {
		const row = files.find((f) => String(f[0]).toUpperCase() === type);
		return row ? Number(row[1]) : null;
	};
	return {
		name: String(props[0]),
		owner: props[1] == null ? null : String(props[1]),
		collation: props[2] == null ? null : String(props[2]),
		createDate: String(props[3]),
		compatibilityLevel: Number(props[4]),
		recoveryModel: String(props[5]),
		state: String(props[6]),
		userConnections: props[7] == null ? null : Number(props[7]),
		dataMb: sizeOf('ROWS'),
		logMb: sizeOf('LOG')
	};
}

/** Human-friendly type label, e.g. varchar(50), decimal(18,2), nvarchar(max). */
export function formatType(c: ColumnInfo): string {
	const t = c.type.toLowerCase();
	if (['varchar', 'char', 'varbinary', 'binary'].includes(t)) {
		return `${t}(${c.maxLength === -1 ? 'max' : c.maxLength})`;
	}
	if (['nvarchar', 'nchar'].includes(t)) {
		return `${t}(${c.maxLength === -1 ? 'max' : c.maxLength / 2})`;
	}
	if (['decimal', 'numeric'].includes(t)) return `${t}(${c.precision},${c.scale})`;
	if (['datetime2', 'datetimeoffset', 'time'].includes(t) && c.scale !== 7) return `${t}(${c.scale})`;
	return t;
}
