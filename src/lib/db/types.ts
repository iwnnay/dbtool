export type DatabaseEngine = 'mssql' | 'postgres' | 'sqlite';

export interface ConnectionCapabilities {
	listDatabases: boolean;
	schemas: boolean;
	procedures: boolean;
	databaseProperties: boolean;
}

interface ConnectionProfileBase {
	id: string;
	name: string;
	type: DatabaseEngine;
}

export interface SqlServerProfile extends ConnectionProfileBase {
	type: 'mssql';
	server: string;
}

export interface PostgresProfile extends ConnectionProfileBase {
	type: 'postgres';
	host: string;
	port: number;
	user: string;
	/** Optional initial database used while listing databases. */
	database?: string;
	/** Stored in plaintext in data/config.json. */
	password?: string;
	/** Legacy profile support; new connections store `password` directly. */
	passwordEnv?: string;
	ssl?: boolean;
}

export interface SqliteProfile extends ConnectionProfileBase {
	type: 'sqlite';
	path: string;
	readOnly?: boolean;
}

export type ConnectionProfile = SqlServerProfile | PostgresProfile | SqliteProfile;
export type ConnectionProfileInput =
	| Omit<SqlServerProfile, 'id'>
	| Omit<PostgresProfile, 'id'>
	| Omit<SqliteProfile, 'id'>;

export const CAPABILITIES: Record<DatabaseEngine, ConnectionCapabilities> = {
	mssql: { listDatabases: true, schemas: true, procedures: true, databaseProperties: true },
	postgres: { listDatabases: true, schemas: true, procedures: true, databaseProperties: true },
	sqlite: { listDatabases: false, schemas: false, procedures: false, databaseProperties: true }
};

export function defaultDatabase(profile: ConnectionProfile): string {
	if (profile.type === 'mssql') return 'master';
	if (profile.type === 'postgres') return profile.database || 'postgres';
	return 'main';
}

export function quoteIdentifier(engine: DatabaseEngine, name: string): string {
	if (engine === 'mssql') return /^[a-z_][a-z0-9_$]*$/i.test(name) ? name : `[${name.replace(/]/g, ']]')}]`;
	if (engine === 'postgres' && /^[a-z_][a-z0-9_$]*$/.test(name)) return name;
	if (engine === 'sqlite' && /^[a-z_][a-z0-9_$]*$/.test(name) && !['select','from','where','table','group','order','index'].includes(name)) return name;
	return `"${name.replace(/"/g, '""')}"`;
}

export function qualifyObject(
	engine: DatabaseEngine,
	schema: string,
	name: string,
	database?: string
): string {
	const q = (part: string) => quoteIdentifier(engine, part);
	if (engine === 'sqlite') return schema && schema !== 'main' ? `${q(schema)}.${q(name)}` : q(name);
	const object = `${q(schema)}.${q(name)}`;
	return engine === 'mssql' && database ? `${q(database)}.${object}` : object;
}

export function sampleSelect(
	engine: DatabaseEngine,
	schema: string,
	table: string,
	rows: number
): string {
	const target = qualifyObject(engine, schema, table);
	return engine === 'mssql'
		? `SELECT TOP (${rows}) *\nFROM ${target};\n`
		: `SELECT *\nFROM ${target}\nLIMIT ${rows};\n`;
}
