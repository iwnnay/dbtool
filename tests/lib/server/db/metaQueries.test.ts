import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	query: vi.fn(), ensureBridge: vi.fn(), getConnection: vi.fn(),
	listDialectDatabases: vi.fn(), listDialectObjects: vi.fn(), dialectDefinition: vi.fn(),
	listDialectColumns: vi.fn(), dialectTableDetail: vi.fn(), searchDialectColumns: vi.fn(), dialectProperties: vi.fn(),
	ignoreSet: vi.fn(), isIgnored: vi.fn()
}));
vi.mock('$lib/server/db/bridgeManager', () => ({ ensureBridge: mocks.ensureBridge }));
vi.mock('$lib/server/store', () => ({ getConnection: mocks.getConnection }));
vi.mock('$lib/server/db/dialectMeta', () => ({
	listDialectDatabases: mocks.listDialectDatabases, listDialectObjects: mocks.listDialectObjects,
	dialectDefinition: mocks.dialectDefinition, listDialectColumns: mocks.listDialectColumns,
	dialectTableDetail: mocks.dialectTableDetail, searchDialectColumns: mocks.searchDialectColumns,
	dialectProperties: mocks.dialectProperties
}));
vi.mock('$lib/server/ignore', () => ({ ignoreSet: mocks.ignoreSet, isIgnored: mocks.isIgnored }));

import {
	dbProperties, listColumns, listDatabases, listObjects, objectDefinition,
	searchColumns, tableDetail
} from '$lib/server/db/meta';

const mssql = { id: 's', name: 'SQL', type: 'mssql' as const, server: '.' };
const sqlite = { id: 'lite', name: 'Lite', type: 'sqlite' as const, path: 'x' };
const ok = (...sets: unknown[][][]) => ({ ok: true, resultSets: sets.map((rows) => ({ rows })) });

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getConnection.mockReturnValue(mssql);
	mocks.ensureBridge.mockResolvedValue({ query: mocks.query });
	mocks.ignoreSet.mockReturnValue(new Set(['dbo.hidden']));
	mocks.isIgnored.mockImplementation((_set, schema, table) => `${schema}.${table}` === 'dbo.hidden');
});

describe('SQL Server metadata queries', () => {
	it('lists databases, objects, definitions, and columns', async () => {
		mocks.query.mockResolvedValueOnce(ok([['master', 1], ['app', 0]]));
		expect(await listDatabases('s')).toEqual([{ name: 'master', isSystem: true }, { name: 'app', isSystem: false }]);

		mocks.query.mockResolvedValueOnce(ok([['dbo', 'people', 'U'], ['dbo', 'v', 'V'], ['dbo', 'p', 'P'], ['dbo', 'odd', 'X']]));
		expect((await listObjects('s', 'odd]db')).map((object) => object.type)).toEqual(['table', 'view', 'procedure', 'table']);
		expect(mocks.query.mock.calls.at(-1)?.[0]).toContain('[odd]]db]');

		mocks.query.mockResolvedValueOnce(ok([["CREATE VIEW x AS SELECT 1"]]));
		expect(await objectDefinition('s', 'app', "d'bo", "x'y")).toContain('CREATE VIEW');
		expect(mocks.query.mock.calls.at(-1)?.[0]).toContain("d''bo");
		mocks.query.mockResolvedValueOnce(ok([]));
		await expect(objectDefinition('s', 'app', 'dbo', 'missing')).rejects.toThrow('No definition found');

		mocks.query.mockResolvedValueOnce(ok([['id', 'int', 4, 10, 0, false, true, false, 1]]));
		expect(await listColumns('s', 'app', 'dbo', 'people')).toEqual([{
			name: 'id', type: 'int', maxLength: 4, precision: 10, scale: 0,
			nullable: false, identity: true, computed: false, isPk: true
		}]);
	});

	it('maps a complete table detail including nullable metadata fields', async () => {
		mocks.query.mockResolvedValueOnce(ok(
			[['USER_TABLE', 'dbo', 'people', 12]],
			[['id', 'int', 4, 10, 0, false, true, false, 1]],
			[[null, 'HEAP', false, false, null, null], ['pk', 'CLUSTERED', true, true, 'id', 'name']],
			[['fk', null, 'dbo.owner', null]],
			[['inbound', 'dbo.child', null, null]]
		));
		expect(await tableDetail('s', 'app', 'dbo', 'people')).toEqual(expect.objectContaining({
			schema: 'dbo', name: 'people', rowCount: 12,
			indexes: [
				{ name: '(unnamed)', type: 'HEAP', unique: false, primaryKey: false, keyColumns: '', includedColumns: null },
				{ name: 'pk', type: 'CLUSTERED', unique: true, primaryKey: true, keyColumns: 'id', includedColumns: 'name' }
			],
			foreignKeys: [{ name: 'fk', columns: '', referencedTable: 'dbo.owner', referencedColumns: '' }],
			referencedBy: [{ name: 'inbound', childTable: 'dbo.child', childColumns: '', columns: '' }]
		}));
		mocks.query.mockResolvedValueOnce(ok([]));
		await expect(tableDetail('s', 'app', 'dbo', 'gone')).rejects.toThrow('not found');
	});

	it('groups column search hits, filters ignored tables, and escapes prefixes', async () => {
		mocks.query.mockResolvedValueOnce(ok([
			['dbo', 'people', 'person_id', 'int'], ['sales', 'orders', 'person_id', 'int'],
			['dbo', 'hidden', 'person_id', 'int'], ['dbo', 'people', 'person_name', 'varchar']
		]));
		expect(await searchColumns('s', 'app', "p%_['")).toEqual([
			{ name: 'person_id', count: 2, example: 'dbo.people', type: 'int' },
			{ name: 'person_name', count: 1, example: 'dbo.people', type: 'varchar' }
		]);
		const sql = mocks.query.mock.calls.at(-1)?.[0] as string;
		expect(sql).toContain("p\\%\\_\\[''%");
	});

	it('maps database properties and missing optional file sizes', async () => {
		mocks.query.mockResolvedValueOnce(ok(
			[['app', null, null, 'today', 160, 'FULL', 'ONLINE', null]],
			[['ROWS', 12.5], ['LOG', 3]]
		));
		expect(await dbProperties('s', "a'pp")).toEqual({
			name: 'app', owner: null, collation: null, createDate: 'today', compatibilityLevel: 160,
			recoveryModel: 'FULL', state: 'ONLINE', userConnections: null, dataMb: 12.5, logMb: 3
		});
		mocks.query.mockResolvedValueOnce(ok([['empty', 'sa', 'coll', 'today', 150, 'SIMPLE', 'ONLINE', 2]], []));
		expect(await dbProperties('s', 'empty')).toEqual(expect.objectContaining({ owner: 'sa', dataMb: null, logMb: null, userConnections: 2 }));
		mocks.query.mockResolvedValueOnce(ok([], []));
		await expect(dbProperties('s', 'gone')).rejects.toThrow('Database not found');
	});

	it('surfaces bridge errors and their fallback message', async () => {
		mocks.query.mockResolvedValueOnce({ ok: false, error: 'offline' });
		await expect(listDatabases('s')).rejects.toThrow('offline');
		mocks.query.mockResolvedValueOnce({ ok: false });
		await expect(listDatabases('s')).rejects.toThrow('Metadata query failed');
	});
});

describe('metadata dispatch', () => {
	it('rejects unknown connections for every public query', async () => {
		mocks.getConnection.mockReturnValue(null);
		for (const call of [
			() => listDatabases('x'), () => listObjects('x', 'd'), () => objectDefinition('x', 'd', 's', 't'),
			() => listColumns('x', 'd', 's', 't'), () => tableDetail('x', 'd', 's', 't'),
			() => searchColumns('x', 'd', ''), () => dbProperties('x', 'd')
		]) await expect(call()).rejects.toThrow('Unknown connection: x');
	});

	it('delegates every non-SQL Server operation to its dialect adapter', async () => {
		mocks.getConnection.mockReturnValue(sqlite);
		mocks.listDialectDatabases.mockResolvedValue(['db']);
		mocks.listDialectObjects.mockResolvedValue(['object']);
		mocks.dialectDefinition.mockResolvedValue('definition');
		mocks.listDialectColumns.mockResolvedValue(['column']);
		mocks.dialectTableDetail.mockResolvedValue({ name: 'detail' });
		mocks.searchDialectColumns.mockResolvedValue(['hit']);
		mocks.dialectProperties.mockResolvedValue({ name: 'properties' });
		expect(await listDatabases('lite')).toEqual(['db']);
		expect(await listObjects('lite', 'd')).toEqual(['object']);
		expect(await objectDefinition('lite', 'd', 's', 't')).toBe('definition');
		expect(await listColumns('lite', 'd', 's', 't')).toEqual(['column']);
		expect(await tableDetail('lite', 'd', 's', 't')).toEqual({ name: 'detail' });
		expect(await searchColumns('lite', 'd', 'p')).toEqual(['hit']);
		expect(await dbProperties('lite', 'd')).toEqual({ name: 'properties' });
	});
});
