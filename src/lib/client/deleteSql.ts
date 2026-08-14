/**
 * Builds DELETE statements for rows picked out of a result grid: locate the
 * source table's primary key inside the result set's columns, then turn each
 * selected row into `DELETE FROM <table> WHERE <key> = <value>;`.
 */
import type { ColumnInfo, SqlResultSet } from './api';
import { bracket } from './catalog.svelte';

export interface KeyColumn {
	column: ColumnInfo;
	resultIndex: number;
}

export type KeyLookup = { ok: true; keyColumns: KeyColumn[] } | { ok: false; reason: string };

const NUMERIC_TYPES = new Set([
	'int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'
]);
const NATIONAL_TYPES = new Set(['nvarchar', 'nchar', 'ntext', 'sysname']);
const BINARY_TYPES = new Set(['binary', 'varbinary', 'image', 'timestamp', 'rowversion']);

export function qualifyTable(schema: string, table: string, database?: string): string {
	const name = `${bracket(schema)}.${bracket(table)}`;
	return database ? `${bracket(database)}.${name}` : name;
}

export function findKeyColumns(
	resultSet: SqlResultSet,
	tableColumns: ColumnInfo[],
	tableName: string
): KeyLookup {
	const primaryKey = tableColumns.filter((column) => column.isPk);
	if (primaryKey.length === 0) {
		return { ok: false, reason: `${tableName} has no primary key to match rows on` };
	}
	const keyColumns: KeyColumn[] = [];
	const missing: string[] = [];
	for (const column of primaryKey) {
		const resultIndex = resultSet.columns.findIndex(
			(candidate) => candidate.name.toLowerCase() === column.name.toLowerCase()
		);
		if (resultIndex < 0) missing.push(column.name);
		else keyColumns.push({ column, resultIndex });
	}
	if (missing.length > 0) {
		return {
			ok: false,
			reason: `these results do not include ${tableName}'s primary key column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} — select ${missing.length > 1 ? 'them' : 'it'} to delete rows`
		};
	}
	return { ok: true, keyColumns };
}

export function sqlLiteral(value: unknown, columnName: string, type: string): string {
	if (value == null) {
		throw new Error(
			`Key column "${columnName}" is NULL in the selected row — a DELETE cannot match a row on a NULL key`
		);
	}
	if (BINARY_TYPES.has(type)) {
		throw new Error(
			`Key column "${columnName}" is ${type}; binary key values from the grid cannot be turned into a literal safely`
		);
	}
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new Error(`Key column "${columnName}" holds ${value}, which is not a usable ${type} literal`);
		}
		return String(value);
	}
	const text = String(value);
	if (NUMERIC_TYPES.has(type)) {
		if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text.trim())) {
			throw new Error(`Key column "${columnName}": "${text}" is not a valid ${type} value`);
		}
		return text.trim();
	}
	if (type === 'bit') {
		const bit = text.trim().toLowerCase();
		if (['1', 'true'].includes(bit)) return '1';
		if (['0', 'false'].includes(bit)) return '0';
		throw new Error(`Key column "${columnName}": "${text}" is not a valid bit value`);
	}
	const quoted = `'${text.replace(/'/g, "''")}'`;
	return NATIONAL_TYPES.has(type) ? `N${quoted}` : quoted;
}

export function buildDeleteSql(
	target: string,
	keyColumns: KeyColumn[],
	resultSet: SqlResultSet,
	rowIndexes: number[]
): string {
	if (rowIndexes.length === 0) {
		throw new Error(`No rows are selected, so there is nothing to delete from ${target}`);
	}
	return rowIndexes
		.map((rowIndex) => {
			const row = resultSet.rows[rowIndex];
			if (!row) {
				throw new Error(
					`Row ${rowIndex + 1} is no longer in this result set (it holds ${resultSet.rows.length} rows) — refresh the results and try again`
				);
			}
			const predicate = keyColumns
				.map(
					({ column, resultIndex }) =>
						`${bracket(column.name)} = ${sqlLiteral(row[resultIndex], column.name, column.type)}`
				)
				.join(' AND ');
			return `DELETE FROM ${target} WHERE ${predicate};`;
		})
		.join('\n');
}
