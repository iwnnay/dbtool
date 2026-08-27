import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const files = new Map<string, string>();
	return {
		files,
		fs: {
			mkdirSync: vi.fn(),
			readFileSync: vi.fn((path: unknown) => {
				const value = files.get(String(path));
				if (value === undefined) throw new Error('ENOENT');
				return value;
			}),
			writeFileSync: vi.fn((path: unknown, value: unknown) => files.set(String(path), String(value))),
			readdirSync: vi.fn((dir: unknown) => [...files.keys()]
				.filter((file) => file.startsWith(`${String(dir)}\\`))
				.map((file) => file.slice(String(dir).length + 1))),
			unlinkSync: vi.fn((path: unknown) => {
				if (!files.delete(String(path))) throw new Error('ENOENT');
			})
		},
		uuid: vi.fn(() => 'uuid-1')
	};
});

vi.mock('node:fs', () => ({ default: mocks.fs }));
vi.mock('node:crypto', () => ({ randomUUID: mocks.uuid }));

import {
	addConnection, addSqlServer, createSheet, deleteSheet, getConnection, getSheet,
	listConnections, listSheets, removeConnection, updateSheet
} from '$lib/server/store';

beforeEach(() => {
	mocks.files.clear();
	vi.clearAllMocks();
	mocks.uuid.mockReturnValue('uuid-1');
});

describe('connection persistence', () => {
	it('starts empty, persists profiles, creates unique ids, and removes them', () => {
		expect(listConnections()).toEqual([]);
		expect(addConnection({ name: 'My Local DB', type: 'sqlite', path: 'one.db' })[0].id).toBe('My-Local-DB');
		expect(addConnection({ name: 'My Local DB', type: 'sqlite', path: 'two.db' })[1].id).toBe('My-Local-DB-2');
		expect(addConnection({ id: 'fixed', name: 'PG', type: 'postgres', host: 'localhost', port: 5432, user: 'me' })).toHaveLength(3);
		expect(getConnection('fixed')?.name).toBe('PG');
		expect(getConnection('missing')).toBeNull();
		expect(() => addConnection({ id: 'fixed', name: 'Again', type: 'sqlite', path: 'x' })).toThrow('already exists');
		expect(removeConnection('fixed').map((item) => item.id)).toEqual(['My-Local-DB', 'My-Local-DB-2']);
	});

	it('migrates legacy server lists and supports the SQL Server helper', () => {
		mocks.files.set(expectPath('config.json'), JSON.stringify({ servers: ['alpha'] }));
		expect(listConnections()).toEqual([{ id: 'alpha', name: 'alpha', type: 'mssql', server: 'alpha' }]);
		expect(addSqlServer('beta').map((item) => item.name)).toEqual(['alpha', 'beta']);
	});

	it('persists PostgreSQL passwords directly in the connection profile', () => {
		const connections = addConnection({
			name: 'PG', type: 'postgres', host: 'localhost', port: 5432,
			user: 'me', database: 'app', password: 'plain-secret'
		});
		expect(connections[0]).toEqual(expect.objectContaining({ password: 'plain-secret' }));
		const config = [...mocks.files.entries()].find(([path]) => path.endsWith('config.json'))?.[1];
		expect(config).toContain('plain-secret');
	});

	it('recovers from malformed and incomplete config files', () => {
		mocks.files.set(expectPath('config.json'), '{bad');
		expect(listConnections()).toEqual([]);
		mocks.files.set(expectPath('config.json'), '{}');
		expect(listConnections()).toEqual([]);
		expect(addConnection({ name: '***', type: 'sqlite', path: 'x' })[0].id).toBe('connection');
	});
});

describe('sheet persistence', () => {
	it('creates, names, orders, closes, updates, reads, and deletes sheets', () => {
		const first = createSheet({ sql: 'select 1' });
		mocks.uuid.mockReturnValueOnce('uuid-2');
		const second = createSheet({ name: 'Pinned', server: 's', database: 'd', position: 99 });
		expect(first.name).toBe('Query 1');
		expect(second.position).toBe(1);
		expect(listSheets().map((sheet) => sheet.id)).toEqual(['uuid-1', 'uuid-2']);

		const closed = updateSheet(first.id, { name: 'Renamed', open: false, id: 'evil', createdAt: 'evil' });
		expect(closed.id).toBe(first.id);
		expect(closed.createdAt).toBe(first.createdAt);
		expect(closed.updatedAt).toBeTruthy();
		expect(listSheets()).toHaveLength(1);
		expect(listSheets({ includeClosed: true })).toHaveLength(2);
		expect(getSheet(first.id)?.name).toBe('Renamed');
		deleteSheet(first.id);
		expect(getSheet(first.id)).toBeNull();
		deleteSheet(first.id);
	});

	it('skips non-json and corrupt files and rejects path-like ids', () => {
		mocks.files.set(expectPath('sheets\\notes.txt'), 'ignored');
		mocks.files.set(expectPath('sheets\\broken.json'), '{bad');
		expect(listSheets()).toEqual([]);
		expect(getSheet('../secret')).toBeNull();
		expect(() => updateSheet('../secret', {})).toThrow('Bad sheet id');
	});
});

function expectPath(suffix: string): string {
	const match = [...mocks.files.keys()].find((path) => path.endsWith(suffix));
	if (match) return match;
	return `${process.cwd()}\\data\\${suffix}`;
}
