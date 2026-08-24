import { ensureBridge } from './bridgeManager';
import { quoteIdentifier, type ConnectionProfile } from '$lib/db/types';
import type {
	ColumnInfo, ColumnSearchHit, DatabaseInfo, DbObject, DbProperties, IndexInfo,
	OutboundForeignKey, InboundForeignKey, TableDetail
} from './meta';

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function rows(profile: ConnectionProfile, database: string, sql: string): Promise<unknown[][]> {
	const bridge = await ensureBridge(`meta:${profile.id}:${database}`, profile.id, database);
	const result = await bridge.query(sql, { maxRows: 50_000, timeout: 60 });
	if (!result.ok) throw new Error(result.error ?? 'Metadata query failed');
	return result.resultSets?.[0]?.rows ?? [];
}

export async function listDialectDatabases(profile: ConnectionProfile): Promise<DatabaseInfo[]> {
	if (profile.type === 'sqlite') return [{ name: 'main', isSystem: false }];
	if (profile.type !== 'postgres') throw new Error(`Unsupported metadata engine: ${profile.type}`);
	const result = await rows(profile, profile.database || 'postgres',
		`SELECT datname, datname IN ('postgres','template0','template1')
		 FROM pg_database WHERE datallowconn ORDER BY datname`);
	return result.map((row) => ({ name: String(row[0]), isSystem: row[1] === true }));
}

export async function listDialectObjects(profile: ConnectionProfile, database: string): Promise<DbObject[]> {
	if (profile.type === 'postgres') {
		const result = await rows(profile, database,
			`SELECT n.nspname, c.relname, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END
			 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
			 WHERE c.relkind IN ('r','p','v','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
			 UNION ALL
			 SELECT DISTINCT n.nspname, p.proname, 'procedure' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
			 WHERE p.prokind='p' AND n.nspname NOT IN ('pg_catalog','information_schema')
			 ORDER BY 1,2`);
		return result.map((row) => ({ schema: String(row[0]), name: String(row[1]), type: row[2] as DbObject['type'] }));
	}
	const result = await rows(profile, database,
		`SELECT 'main', name, CASE type WHEN 'view' THEN 'view' ELSE 'table' END
		 FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`);
	return result.map((row) => ({ schema: 'main', name: String(row[1]), type: row[2] as DbObject['type'] }));
}

export async function dialectDefinition(
	profile: ConnectionProfile, database: string, schema: string, name: string
): Promise<string> {
	if (profile.type === 'postgres') {
		const result = await rows(profile, database,
			`SELECT CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true)
			 ELSE pg_get_functiondef(p.oid) END
			 FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=${literal(name)}
			 LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=${literal(name)}
			 WHERE n.nspname=${literal(schema)} LIMIT 1`);
		return result[0]?.[0] == null ? '' : String(result[0][0]);
	}
	const result = await rows(profile, database,
		`SELECT sql FROM sqlite_schema WHERE name=${literal(name)} LIMIT 1`);
	return result[0]?.[0] == null ? '' : String(result[0][0]);
}

export async function listDialectColumns(
	profile: ConnectionProfile, database: string, schema: string, table: string
): Promise<ColumnInfo[]> {
	if (profile.type === 'postgres') {
		const result = await rows(profile, database,
			`SELECT a.attname, CASE t.typname
			 WHEN 'int2' THEN 'smallint' WHEN 'int4' THEN 'integer' WHEN 'int8' THEN 'bigint'
			 WHEN 'float4' THEN 'real' WHEN 'float8' THEN 'double precision' WHEN 'bool' THEN 'boolean'
			 WHEN 'varchar' THEN 'varchar' WHEN 'bpchar' THEN 'char' ELSE t.typname END,
			 COALESCE(character_maximum_length,0), COALESCE(numeric_precision,0), COALESCE(numeric_scale,0),
			 NOT a.attnotnull, (a.attidentity <> '' OR COALESCE(pg_get_expr(ad.adbin,ad.adrelid),'') LIKE 'nextval(%'), a.attgenerated <> '',
			 EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=a.attrelid AND i.indisprimary AND a.attnum=ANY(i.indkey))
			 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
			 JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
			 LEFT JOIN information_schema.columns ic ON ic.table_schema=n.nspname AND ic.table_name=c.relname AND ic.column_name=a.attname
			 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(table)} AND a.attnum>0 AND NOT a.attisdropped
			 ORDER BY a.attnum`);
		return result.map(columnRow);
	}
	const qSchema = quoteIdentifier('sqlite', schema || 'main');
	const qTable = quoteIdentifier('sqlite', table);
	const result = await rows(profile, database, `PRAGMA ${qSchema}.table_xinfo(${qTable})`);
	return result.map((row) => {
		const declared = String(row[2] || '');
		const match = declared.match(/^([^ (]+)(?:\((\d+)(?:,(\d+))?\))?/);
		return {
			name: String(row[1]), type: (match?.[1] || declared || 'text').toLowerCase(),
			maxLength: Number(match?.[2] || 0), precision: Number(match?.[2] || 0), scale: Number(match?.[3] || 0),
			nullable: row[3] !== 1, identity: Number(row[5]) > 0 && /^integer$/i.test(declared.trim()),
			computed: Number(row[6] || 0) > 1, isPk: Number(row[5]) > 0
		};
	});
}

function columnRow(row: unknown[]): ColumnInfo {
	return {
		name: String(row[0]), type: String(row[1]), maxLength: Number(row[2]), precision: Number(row[3]),
		scale: Number(row[4]), nullable: row[5] === true, identity: row[6] === true,
		computed: row[7] === true, isPk: row[8] === true
	};
}

export async function dialectTableDetail(
	profile: ConnectionProfile, database: string, schema: string, table: string
): Promise<TableDetail> {
	const columns = await listDialectColumns(profile, database, schema, table);
	let rowCount: number | null = null;
	let indexes: IndexInfo[] = [];
	let foreignKeys: OutboundForeignKey[] = [];
	let referencedBy: InboundForeignKey[] = [];
	if (profile.type === 'postgres') {
		const stats = await rows(profile, database,
			`SELECT COALESCE(c.reltuples,0)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
			 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(table)}`);
		rowCount = stats[0] ? Number(stats[0][0]) : null;
		const indexRows = await rows(profile, database,
			`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=${literal(schema)} AND tablename=${literal(table)}`);
		indexes = indexRows.map((row) => ({ name: String(row[0]), type: 'BTREE', unique: /CREATE UNIQUE/i.test(String(row[1])), primaryKey: /_pkey\b/i.test(String(row[0])), keyColumns: String(row[1]), includedColumns: null }));
		const fkRows = await rows(profile, database,
			`SELECT con.conname,
			 string_agg(a.attname, ', ' ORDER BY keycols.ord),
			 rn.nspname || '.' || rc.relname,
			 string_agg(ra.attname, ', ' ORDER BY keycols.ord)
			 FROM pg_constraint con
			 JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
			 JOIN pg_class rc ON rc.oid=con.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
			 JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY keycols(attnum, refattnum, ord) ON true
			 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=keycols.attnum
			 JOIN pg_attribute ra ON ra.attrelid=rc.oid AND ra.attnum=keycols.refattnum
			 WHERE con.contype='f' AND n.nspname=${literal(schema)} AND c.relname=${literal(table)}
			 GROUP BY con.conname, rn.nspname, rc.relname`);
		foreignKeys = fkRows.map((row) => ({ name: String(row[0]), columns: String(row[1]), referencedTable: String(row[2]), referencedColumns: String(row[3]) }));
		const inboundRows = await rows(profile, database,
			`SELECT con.conname, n.nspname || '.' || c.relname,
			 string_agg(a.attname, ', ' ORDER BY keycols.ord), string_agg(ra.attname, ', ' ORDER BY keycols.ord)
			 FROM pg_constraint con
			 JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
			 JOIN pg_class rc ON rc.oid=con.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
			 JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY keycols(attnum, refattnum, ord) ON true
			 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=keycols.attnum
			 JOIN pg_attribute ra ON ra.attrelid=rc.oid AND ra.attnum=keycols.refattnum
			 WHERE con.contype='f' AND rn.nspname=${literal(schema)} AND rc.relname=${literal(table)}
			 GROUP BY con.conname, n.nspname, c.relname`);
		referencedBy = inboundRows.map((row) => ({ name: String(row[0]), childTable: String(row[1]), childColumns: String(row[2]), columns: String(row[3]) }));
	} else {
		const qTarget = `${quoteIdentifier('sqlite', schema || 'main')}.${quoteIdentifier('sqlite', table)}`;
		const count = await rows(profile, database, `SELECT count(*) FROM ${qTarget}`);
		rowCount = Number(count[0]?.[0] ?? 0);
		const fkRows = await rows(profile, database, `PRAGMA ${quoteIdentifier('sqlite', schema || 'main')}.foreign_key_list(${quoteIdentifier('sqlite', table)})`);
		foreignKeys = fkRows.map((row) => ({ name: `fk_${row[0]}`, columns: String(row[3]), referencedTable: String(row[2]), referencedColumns: String(row[4]) }));
	}
	return { schema, name: table, objectType: 'TABLE', rowCount, columns, indexes, foreignKeys, referencedBy };
}

export async function searchDialectColumns(
	profile: ConnectionProfile, database: string, prefix: string
): Promise<ColumnSearchHit[]> {
	if (profile.type === 'postgres') {
		const result = await rows(profile, database,
			`SELECT column_name, count(*), min(table_schema || '.' || table_name), min(data_type)
			 FROM information_schema.columns
			 WHERE table_schema NOT IN ('pg_catalog','information_schema')
			 AND lower(column_name) LIKE lower(${literal(`${prefix}%`)})
			 GROUP BY column_name ORDER BY column_name LIMIT 800`);
		return result.map((row) => ({ name: String(row[0]), count: Number(row[1]), example: String(row[2]), type: String(row[3]) }));
	}
	const objects = await listDialectObjects(profile, database);
	const matching: ColumnSearchHit[] = [];
	for (const object of objects.filter((item) => item.type !== 'procedure')) {
		const columns = await listDialectColumns(profile, database, object.schema, object.name);
		for (const column of columns) if (column.name.toLowerCase().startsWith(prefix.toLowerCase())) {
			matching.push({ name: column.name, count: 1, example: `${object.schema}.${object.name}`, type: column.type });
		}
		if (matching.length >= 800) break;
	}
	return matching;
}

export async function dialectProperties(profile: ConnectionProfile, database: string): Promise<DbProperties> {
	if (profile.type === 'postgres') {
		const result = await rows(profile, database,
			`SELECT current_database(), pg_encoding_to_char(encoding), datcollate, pg_database_size(datname),
			 (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database())
			 FROM pg_database WHERE datname=current_database()`);
		const row = result[0] ?? [];
		return { name: String(row[0]), owner: profile.user || null, collation: String(row[2] ?? ''), createDate: '', compatibilityLevel: 0, recoveryModel: String(row[1] ?? ''), state: 'ONLINE', userConnections: Number(row[4] ?? 0), dataMb: Number(row[3] ?? 0) / 1048576, logMb: null };
	}
	if (profile.type !== 'sqlite') throw new Error(`Unsupported metadata engine: ${profile.type}`);
	const result = await rows(profile, database, `PRAGMA page_count`);
	const size = await rows(profile, database, `PRAGMA page_size`);
	return { name: profile.name, owner: null, collation: null, createDate: '', compatibilityLevel: 0, recoveryModel: profile.readOnly ? 'read-only' : 'read-write', state: 'OPEN', userConnections: 1, dataMb: Number(result[0]?.[0] ?? 0) * Number(size[0]?.[0] ?? 0) / 1048576, logMb: null };
}
