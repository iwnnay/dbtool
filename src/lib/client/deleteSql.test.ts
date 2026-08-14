import { describe, expect, it } from 'vitest';
import { buildDeleteSql, findKeyColumns, qualifyTable, sqlLiteral } from './deleteSql';
import type { ColumnInfo, SqlResultSet } from './api';

function makeResultSet(columns: [string, string][], rows: unknown[][]): SqlResultSet {
	return {
		columns: columns.map(([name, type]) => ({ name, type })),
		rows,
		rowCount: rows.length,
		truncated: false
	};
}

function makeColumn(name: string, type: string, isPk = false): ColumnInfo {
	return {
		name,
		type,
		display: type,
		maxLength: 0,
		precision: 0,
		scale: 0,
		nullable: false,
		identity: false,
		computed: false,
		isPk
	};
}

const orders = makeResultSet(
	[
		['OrderId', 'int'],
		['Customer', 'nvarchar'],
		['Total', 'decimal']
	],
	[
		[1, 'Ada', 19.5],
		[2, "O'Brien", 4],
		[3, 'Alan', 100]
	]
);

const orderColumns = [
	makeColumn('OrderId', 'int', true),
	makeColumn('Customer', 'nvarchar'),
	makeColumn('Total', 'decimal')
];

describe('findKeyColumns', () => {
	it('maps primary key columns onto their result set positions', () => {
		const lookup = findKeyColumns(orders, orderColumns, 'dbo.Orders');
		expect(lookup.ok).toBe(true);
		if (!lookup.ok) return;
		expect(lookup.keyColumns).toHaveLength(1);
		expect(lookup.keyColumns[0].resultIndex).toBe(0);
	});

	it('matches key column names case-insensitively', () => {
		const lowercased = makeResultSet([['orderid', 'int']], [[7]]);
		const lookup = findKeyColumns(lowercased, orderColumns, 'dbo.Orders');
		expect(lookup.ok).toBe(true);
	});

	it('reports a table with no primary key', () => {
		const lookup = findKeyColumns(orders, [makeColumn('OrderId', 'int')], 'dbo.Orders');
		expect(lookup).toEqual({ ok: false, reason: 'dbo.Orders has no primary key to match rows on' });
	});

	it('reports key columns the query did not select', () => {
		const partial = makeResultSet([['Customer', 'nvarchar']], [['Ada']]);
		const lookup = findKeyColumns(partial, orderColumns, 'dbo.Orders');
		expect(lookup.ok).toBe(false);
		if (lookup.ok) return;
		expect(lookup.reason).toContain('primary key column OrderId');
	});
});

describe('sqlLiteral', () => {
	it('leaves numbers unquoted', () => {
		expect(sqlLiteral(42, 'OrderId', 'int')).toBe('42');
	});

	it('quotes strings and doubles embedded quotes', () => {
		expect(sqlLiteral("O'Brien", 'Customer', 'varchar')).toBe("'O''Brien'");
	});

	it('prefixes unicode string types with N', () => {
		expect(sqlLiteral('Ada', 'Customer', 'nvarchar')).toBe("N'Ada'");
	});

	it('quotes uniqueidentifier and datetime values', () => {
		expect(sqlLiteral('2024-03-01T08:30:00', 'CreatedAt', 'datetime')).toBe("'2024-03-01T08:30:00'");
	});

	it('renders booleans as bits', () => {
		expect(sqlLiteral(true, 'Active', 'bit')).toBe('1');
		expect(sqlLiteral(false, 'Active', 'bit')).toBe('0');
	});

	it('refuses NULL key values', () => {
		expect(() => sqlLiteral(null, 'OrderId', 'int')).toThrow(/NULL/);
	});

	it('refuses binary key values', () => {
		expect(() => sqlLiteral('AAEC', 'Hash', 'varbinary')).toThrow(/varbinary/);
	});

	it('refuses non-numeric text for a numeric column', () => {
		expect(() => sqlLiteral('abc', 'OrderId', 'int')).toThrow(/not a valid int/);
	});
});

describe('buildDeleteSql', () => {
	const keyColumns = [{ column: orderColumns[0], resultIndex: 0 }];

	it('builds one statement per selected row', () => {
		const sql = buildDeleteSql('dbo.Orders', keyColumns, orders, [0, 2]);
		expect(sql).toBe('DELETE FROM dbo.Orders WHERE OrderId = 1;\nDELETE FROM dbo.Orders WHERE OrderId = 3;');
	});

	it('ANDs every column of a composite key', () => {
		const lines = makeResultSet(
			[
				['OrderId', 'int'],
				['LineNo', 'int'],
				['Sku', 'nvarchar']
			],
			[[1, 2, 'ABC']]
		);
		const composite = [
			{ column: makeColumn('OrderId', 'int', true), resultIndex: 0 },
			{ column: makeColumn('LineNo', 'int', true), resultIndex: 1 }
		];
		expect(buildDeleteSql('dbo.OrderLines', composite, lines, [0])).toBe(
			'DELETE FROM dbo.OrderLines WHERE OrderId = 1 AND LineNo = 2;'
		);
	});

	it('throws when nothing is selected', () => {
		expect(() => buildDeleteSql('dbo.Orders', keyColumns, orders, [])).toThrow(/nothing to delete/);
	});

	it('throws when a row index is past the end of the result set', () => {
		expect(() => buildDeleteSql('dbo.Orders', keyColumns, orders, [9])).toThrow(/Row 10/);
	});
});

describe('qualifyTable', () => {
	it('emits a two-part name by default', () => {
		expect(qualifyTable('dbo', 'Orders')).toBe('dbo.Orders');
	});

	it('emits a three-part name when the table lives in another database', () => {
		expect(qualifyTable('dbo', 'Orders', 'Sales')).toBe('Sales.dbo.Orders');
	});

	it('brackets names that are not plain identifiers', () => {
		expect(qualifyTable('dbo', 'Order Lines')).toBe('dbo.[Order Lines]');
	});
});
