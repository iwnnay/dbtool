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

export interface IndexInfo {
	name: string;
	type: string;
	unique: boolean;
	primaryKey: boolean;
	keyColumns: string;
	includedColumns: string | null;
}

export interface OutboundForeignKey {
	name: string;
	columns: string;
	referencedTable: string;
	referencedColumns: string;
}

export interface InboundForeignKey {
	name: string;
	childTable: string;
	childColumns: string;
	columns: string;
}

export interface TableDetail {
	schema: string;
	name: string;
	objectType: string;
	rowCount: number | null;
	columns: ColumnInfo[];
	indexes: IndexInfo[];
	foreignKeys: OutboundForeignKey[];
	referencedBy: InboundForeignKey[];
}

export async function tableDetail(
	server: string,
	database: string,
	schema: string,
	table: string
): Promise<TableDetail> {
	const db = bracket(database);
	const fullName = quote(`${bracket(database)}.${bracket(schema)}.${bracket(table)}`);
	const res = await metaQuery(
		server,
		`DECLARE @objectId int = OBJECT_ID(${fullName});

		 SELECT o.type_desc, s.name, o.name,
		        (SELECT TOP 1 p.rows FROM ${db}.sys.partitions p
		         WHERE p.object_id = o.object_id AND p.index_id IN (0, 1))
		 FROM ${db}.sys.objects o
		 JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id
		 WHERE o.object_id = @objectId;

		 SELECT c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
		        c.is_computed, CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END
		 FROM ${db}.sys.columns c
		 JOIN ${db}.sys.types t ON c.user_type_id = t.user_type_id
		 LEFT JOIN (
		   SELECT ic.object_id, ic.column_id
		   FROM ${db}.sys.index_columns ic
		   JOIN ${db}.sys.indexes i
		     ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND i.is_primary_key = 1
		 ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
		 WHERE c.object_id = @objectId
		 ORDER BY c.column_id;

		 SELECT ix.name, ix.type_desc, ix.is_unique, ix.is_primary_key, keyCols.cols, includedCols.cols
		 FROM ${db}.sys.indexes ix
		 OUTER APPLY (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
		              FROM ${db}.sys.index_columns ic
		              JOIN ${db}.sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
		              WHERE ic.object_id = ix.object_id AND ic.index_id = ix.index_id
		                AND ic.is_included_column = 0) keyCols
		 OUTER APPLY (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.index_column_id) AS cols
		              FROM ${db}.sys.index_columns ic
		              JOIN ${db}.sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
		              WHERE ic.object_id = ix.object_id AND ic.index_id = ix.index_id
		                AND ic.is_included_column = 1) includedCols
		 WHERE ix.object_id = @objectId AND ix.type > 0
		 ORDER BY ix.is_primary_key DESC, ix.name;

		 SELECT fk.name, parentCols.cols, refSchema.name + '.' + refTable.name, refCols.cols
		 FROM ${db}.sys.foreign_keys fk
		 JOIN ${db}.sys.tables refTable ON refTable.object_id = fk.referenced_object_id
		 JOIN ${db}.sys.schemas refSchema ON refSchema.schema_id = refTable.schema_id
		 OUTER APPLY (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS cols
		              FROM ${db}.sys.foreign_key_columns fkc
		              JOIN ${db}.sys.columns c ON c.object_id = fkc.parent_object_id
		                AND c.column_id = fkc.parent_column_id
		              WHERE fkc.constraint_object_id = fk.object_id) parentCols
		 OUTER APPLY (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS cols
		              FROM ${db}.sys.foreign_key_columns fkc
		              JOIN ${db}.sys.columns c ON c.object_id = fkc.referenced_object_id
		                AND c.column_id = fkc.referenced_column_id
		              WHERE fkc.constraint_object_id = fk.object_id) refCols
		 WHERE fk.parent_object_id = @objectId
		 ORDER BY fk.name;

		 SELECT fk.name, childSchema.name + '.' + childTable.name, childCols.cols, ownCols.cols
		 FROM ${db}.sys.foreign_keys fk
		 JOIN ${db}.sys.tables childTable ON childTable.object_id = fk.parent_object_id
		 JOIN ${db}.sys.schemas childSchema ON childSchema.schema_id = childTable.schema_id
		 OUTER APPLY (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS cols
		              FROM ${db}.sys.foreign_key_columns fkc
		              JOIN ${db}.sys.columns c ON c.object_id = fkc.parent_object_id
		                AND c.column_id = fkc.parent_column_id
		              WHERE fkc.constraint_object_id = fk.object_id) childCols
		 OUTER APPLY (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS cols
		              FROM ${db}.sys.foreign_key_columns fkc
		              JOIN ${db}.sys.columns c ON c.object_id = fkc.referenced_object_id
		                AND c.column_id = fkc.referenced_column_id
		              WHERE fkc.constraint_object_id = fk.object_id) ownCols
		 WHERE fk.referenced_object_id = @objectId
		 ORDER BY fk.name;`
	);

	const identity = res.resultSets?.[0]?.rows?.[0];
	if (!identity) {
		throw new Error(
			`Table ${schema}.${table} not found in ${database} on ${server} — it may have been dropped or renamed`
		);
	}

	return {
		schema: String(identity[1]),
		name: String(identity[2]),
		objectType: String(identity[0]),
		rowCount: identity[3] == null ? null : Number(identity[3]),
		columns: (res.resultSets?.[1]?.rows ?? []).map((row) => ({
			name: String(row[0]),
			type: String(row[1]),
			maxLength: Number(row[2]),
			precision: Number(row[3]),
			scale: Number(row[4]),
			nullable: row[5] === true,
			identity: row[6] === true,
			computed: row[7] === true,
			isPk: row[8] === 1
		})),
		indexes: (res.resultSets?.[2]?.rows ?? []).map((row) => ({
			name: row[0] == null ? '(unnamed)' : String(row[0]),
			type: String(row[1]),
			unique: row[2] === true,
			primaryKey: row[3] === true,
			keyColumns: row[4] == null ? '' : String(row[4]),
			includedColumns: row[5] == null ? null : String(row[5])
		})),
		foreignKeys: (res.resultSets?.[3]?.rows ?? []).map((row) => ({
			name: String(row[0]),
			columns: row[1] == null ? '' : String(row[1]),
			referencedTable: String(row[2]),
			referencedColumns: row[3] == null ? '' : String(row[3])
		})),
		referencedBy: (res.resultSets?.[4]?.rows ?? []).map((row) => ({
			name: String(row[0]),
			childTable: String(row[1]),
			childColumns: row[2] == null ? '' : String(row[2]),
			columns: row[3] == null ? '' : String(row[3])
		}))
	};
}

const MAX_INBOUND_KEYS = 60;

export function formatTableContext(
	server: string,
	database: string,
	detail: TableDetail,
	description?: string
): string {
	const lines: string[] = [
		`# ${detail.objectType === 'VIEW' ? 'View' : 'Table'}: ${detail.schema}.${detail.name}`,
		`Database: ${database} on ${server}`
	];
	if (detail.rowCount != null) lines.push(`Rows: ${detail.rowCount.toLocaleString()}`);
	if (description) lines.push(`Description: ${description}`);

	lines.push('', '## Columns', 'Format: name type [NULL|NOT NULL] flags');
	for (const column of detail.columns) {
		const flags = [
			column.isPk ? 'PRIMARY KEY' : '',
			column.identity ? 'IDENTITY' : '',
			column.computed ? 'COMPUTED' : ''
		].filter(Boolean);
		lines.push(
			`${column.name} ${formatType(column)} ${column.nullable ? 'NULL' : 'NOT NULL'}` +
				(flags.length ? ` ${flags.join(' ')}` : '')
		);
	}

	if (detail.indexes.length > 0) {
		lines.push('', '## Indexes');
		for (const index of detail.indexes) {
			const tags = [
				index.type,
				index.unique ? 'UNIQUE' : '',
				index.primaryKey ? 'PRIMARY KEY' : ''
			].filter(Boolean);
			lines.push(
				`${index.name} (${tags.join(', ')}): ${index.keyColumns}` +
					(index.includedColumns ? ` INCLUDE (${index.includedColumns})` : '')
			);
		}
	}

	if (detail.foreignKeys.length > 0) {
		lines.push('', `## Foreign keys (${detail.schema}.${detail.name} references)`);
		for (const key of detail.foreignKeys) {
			lines.push(`${key.columns} -> ${key.referencedTable}(${key.referencedColumns})  [${key.name}]`);
		}
	}

	if (detail.referencedBy.length > 0) {
		lines.push('', `## Referenced by (tables pointing at ${detail.schema}.${detail.name})`);
		for (const key of detail.referencedBy.slice(0, MAX_INBOUND_KEYS)) {
			lines.push(`${key.childTable}(${key.childColumns}) -> ${key.columns}  [${key.name}]`);
		}
		if (detail.referencedBy.length > MAX_INBOUND_KEYS) {
			lines.push(`… and ${detail.referencedBy.length - MAX_INBOUND_KEYS} more referencing tables`);
		}
	}

	return lines.join('\n');
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
