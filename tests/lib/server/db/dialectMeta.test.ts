import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '$lib/db/types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), ensureBridge: vi.fn() }));
vi.mock('$lib/server/db/bridgeManager', () => ({ ensureBridge: mocks.ensureBridge }));

import {
	dialectDefinition, dialectProperties, dialectTableDetail, listDialectColumns,
	listDialectDatabases, listDialectObjects, searchDialectColumns
} from '$lib/server/db/dialectMeta';

const postgres: ConnectionProfile = { id: 'pg', name: 'PG', type: 'postgres', host: 'localhost', port: 5432, user: 'ada' };
const sqlite: ConnectionProfile = { id: 'lite', name: 'Lite', type: 'sqlite', path: 'test.db' };
const result = (rows: unknown[][]) => ({ ok: true, resultSets: [{ rows }] });

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ensureBridge.mockResolvedValue({ query: mocks.query });
});

describe('dialect metadata', () => {
	it('covers PostgreSQL discovery, details, search, quoting, and properties', async () => {
		mocks.query.mockResolvedValueOnce(result([['app', false], ['postgres', true]]));
		expect(await listDialectDatabases(postgres)).toEqual([{ name: 'app', isSystem: false }, { name: 'postgres', isSystem: true }]);

		mocks.query.mockResolvedValueOnce(result([['public', 'people', 'table'], ['public', 'refresh', 'procedure']]));
		expect(await listDialectObjects(postgres, 'app')).toHaveLength(2);

		mocks.query.mockResolvedValueOnce(result([["CREATE VIEW people AS SELECT 'x'"]]));
		expect(await dialectDefinition(postgres, 'app', 'pub\'lic', "peo'ple")).toContain('CREATE VIEW');
		expect(mocks.query.mock.calls.at(-1)?.[0]).toContain("peo''ple");

		mocks.query.mockResolvedValueOnce(result([['id', 'integer', 0, 32, 0, false, true, false, true]]));
		expect(await listDialectColumns(postgres, 'app', 'public', 'people')).toEqual([expect.objectContaining({ name: 'id', identity: true, isPk: true })]);

		mocks.query
			.mockResolvedValueOnce(result([['id', 'integer', 0, 32, 0, false, true, false, true]]))
			.mockResolvedValueOnce(result([[42]]))
			.mockResolvedValueOnce(result([['people_pkey', 'CREATE UNIQUE INDEX people_pkey']]))
			.mockResolvedValueOnce(result([['fk_owner', 'owner_id', 'public.owner', 'id']]))
			.mockResolvedValueOnce(result([['fk_child', 'public.child', 'person_id', 'id']]));
		const detail = await dialectTableDetail(postgres, 'app', 'public', 'people');
		expect(detail).toEqual(expect.objectContaining({
			rowCount: 42,
			indexes: [expect.objectContaining({ unique: true, primaryKey: true })],
			foreignKeys: [expect.objectContaining({ name: 'fk_owner' })],
			referencedBy: [expect.objectContaining({ childTable: 'public.child' })]
		}));

		mocks.query.mockResolvedValueOnce(result([['person_id', 3, 'public.people', 'integer']]));
		expect(await searchDialectColumns(postgres, 'app', 'per')).toEqual([{ name: 'person_id', count: 3, example: 'public.people', type: 'integer' }]);

		mocks.query.mockResolvedValueOnce(result([['app', 'UTF8', 'en_US', 2097152, 4]]));
		expect(await dialectProperties(postgres, 'app')).toEqual(expect.objectContaining({ name: 'app', owner: 'ada', dataMb: 2, userConnections: 4 }));
	});

	it('covers SQLite discovery, declared types, details, search, and properties', async () => {
		expect(await listDialectDatabases(sqlite)).toEqual([{ name: 'main', isSystem: false }]);
		mocks.query.mockResolvedValueOnce(result([[null, 'people', 'table'], [null, 'report', 'view']]));
		expect(await listDialectObjects(sqlite, 'main')).toEqual([
			{ schema: 'main', name: 'people', type: 'table' }, { schema: 'main', name: 'report', type: 'view' }
		]);
		mocks.query.mockResolvedValueOnce(result([]));
		expect(await dialectDefinition(sqlite, 'main', 'main', 'missing')).toBe('');

		mocks.query.mockResolvedValueOnce(result([[0, 'id', 'INTEGER', 1, null, 1, 0], [1, 'amount', 'DECIMAL(8,3)', 0, null, 0, 2], [2, 'note', '', 0, null, 0, 0]]));
		const columns = await listDialectColumns(sqlite, 'main', 'main', 'odd table');
		expect(columns).toEqual([
			expect.objectContaining({ name: 'id', type: 'integer', identity: true, isPk: true, nullable: false }),
			expect.objectContaining({ name: 'amount', type: 'decimal', precision: 8, scale: 3, computed: true }),
			expect.objectContaining({ name: 'note', type: 'text' })
		]);

		mocks.query
			.mockResolvedValueOnce(result([[0, 'id', 'INTEGER', 1, null, 1, 0]]))
			.mockResolvedValueOnce(result([[7]]))
			.mockResolvedValueOnce(result([[0, 0, 'owner', 'owner_id', 'id']]));
		const detail = await dialectTableDetail(sqlite, 'main', 'main', 'people');
		expect(detail.rowCount).toBe(7);
		expect(detail.foreignKeys).toEqual([{ name: 'fk_0', columns: 'owner_id', referencedTable: 'owner', referencedColumns: 'id' }]);
		expect(detail.indexes).toEqual([]);

		mocks.query
			.mockResolvedValueOnce(result([[null, 'people', 'table'], [null, 'report', 'view']]))
			.mockResolvedValueOnce(result([[0, 'PersonId', 'INTEGER', 0, null, 1, 0]]))
			.mockResolvedValueOnce(result([[0, 'title', 'TEXT', 0, null, 0, 0]]));
		expect(await searchDialectColumns(sqlite, 'main', 'person')).toEqual([{ name: 'PersonId', count: 1, example: 'main.people', type: 'integer' }]);

		mocks.query.mockResolvedValueOnce(result([[4]])).mockResolvedValueOnce(result([[4096]]));
		expect(await dialectProperties({ ...sqlite, readOnly: true }, 'main')).toEqual(expect.objectContaining({ name: 'Lite', recoveryModel: 'read-only', dataMb: 0.015625 }));
	});

	it('rejects unsupported engines and bridge failures, and tolerates empty results', async () => {
		const mssql: ConnectionProfile = { id: 'ms', name: 'MS', type: 'mssql', server: '.' };
		await expect(listDialectDatabases(mssql)).rejects.toThrow('Unsupported metadata engine');
		await expect(dialectProperties(mssql, 'master')).rejects.toThrow('Unsupported metadata engine');
		mocks.query.mockResolvedValueOnce({ ok: false, error: 'offline' });
		await expect(listDialectObjects(sqlite, 'main')).rejects.toThrow('offline');
		mocks.query.mockResolvedValueOnce({ ok: false });
		await expect(listDialectObjects(sqlite, 'main')).rejects.toThrow('Metadata query failed');
		mocks.query.mockResolvedValueOnce({ ok: true });
		expect(await dialectDefinition(sqlite, 'main', 'main', 'x')).toBe('');
	});
});
