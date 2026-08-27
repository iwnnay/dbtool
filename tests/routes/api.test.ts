import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listConnections: vi.fn(), addConnection: vi.fn(), addSqlServer: vi.fn(), removeConnection: vi.fn(),
	listSheets: vi.fn(), createSheet: vi.fn(), updateSheet: vi.fn(), deleteSheet: vi.fn(),
	listDatabases: vi.fn(), listObjects: vi.fn(), listColumns: vi.fn(), formatType: vi.fn(),
	searchColumns: vi.fn(), objectDefinition: vi.fn(), dbProperties: vi.fn(),
	loadIgnoreList: vi.fn(), saveIgnoreList: vi.fn(), ignoreSet: vi.fn(), isIgnored: vi.fn(),
	listRuns: vi.fn(), countRuns: vi.fn(), clearRuns: vi.fn(),
	killBridgesFor: vi.fn(), killBridge: vi.fn(),
	loadDatamap: vi.fn(), jobStatus: vi.fn(), startGenerate: vi.fn(), checkStale: vi.fn(),
	askModelStatus: vi.fn()
}));

vi.mock('$lib/server/store', () => ({
	listConnections: mocks.listConnections, addConnection: mocks.addConnection,
	addSqlServer: mocks.addSqlServer, removeConnection: mocks.removeConnection,
	listSheets: mocks.listSheets, createSheet: mocks.createSheet,
	updateSheet: mocks.updateSheet, deleteSheet: mocks.deleteSheet
}));
vi.mock('$lib/server/db/meta', () => ({
	listDatabases: mocks.listDatabases, listObjects: mocks.listObjects,
	listColumns: mocks.listColumns, formatType: mocks.formatType,
	searchColumns: mocks.searchColumns, objectDefinition: mocks.objectDefinition,
	dbProperties: mocks.dbProperties
}));
vi.mock('$lib/server/ignore', () => ({
	loadIgnoreList: mocks.loadIgnoreList, saveIgnoreList: mocks.saveIgnoreList,
	ignoreSet: mocks.ignoreSet, isIgnored: mocks.isIgnored
}));
vi.mock('$lib/server/history', () => ({
	listRuns: mocks.listRuns, countRuns: mocks.countRuns, clearRuns: mocks.clearRuns
}));
vi.mock('$lib/server/db/bridgeManager', () => ({
	killBridgesFor: mocks.killBridgesFor, killBridge: mocks.killBridge
}));
vi.mock('$lib/server/db/datamap', () => ({
	loadDatamap: mocks.loadDatamap, jobStatus: mocks.jobStatus,
	startGenerate: mocks.startGenerate, checkStale: mocks.checkStale
}));
vi.mock('$lib/server/llm/model', () => ({ askModelStatus: mocks.askModelStatus }));

import * as servers from '../../src/routes/api/db/servers/+server';
import * as sheets from '../../src/routes/api/sheets/+server';
import * as sheet from '../../src/routes/api/sheets/[id]/+server';
import * as databases from '../../src/routes/api/db/databases/+server';
import * as objects from '../../src/routes/api/db/objects/+server';
import * as columns from '../../src/routes/api/db/columns/+server';
import * as columnsearch from '../../src/routes/api/db/columnsearch/+server';
import * as definition from '../../src/routes/api/db/definition/+server';
import * as properties from '../../src/routes/api/db/properties/+server';
import * as ignore from '../../src/routes/api/db/ignore/+server';
import * as history from '../../src/routes/api/db/history/+server';
import * as disconnect from '../../src/routes/api/db/disconnect/+server';
import * as cancel from '../../src/routes/api/db/cancel/+server';
import * as datamap from '../../src/routes/api/db/datamap/+server';

const event = (url = 'http://test.local/', body?: unknown, params: Record<string, string> = {}) => ({
	url: new URL(url),
	params,
	request: body instanceof Request ? body : new Request(url, body === undefined ? undefined : {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body)
	})
}) as never;
const data = (response: Response) => response.json();

beforeEach(() => {
	vi.clearAllMocks();
	mocks.listConnections.mockReturnValue([{ id: 's' }]);
	mocks.addConnection.mockReturnValue([{ id: 'new' }]);
	mocks.addSqlServer.mockReturnValue([{ id: 'legacy' }]);
	mocks.removeConnection.mockReturnValue([]);
	mocks.listSheets.mockReturnValue([{ id: 'one' }]);
	mocks.createSheet.mockReturnValue({ id: 'new' });
	mocks.updateSheet.mockReturnValue({ id: 'one' });
	mocks.listDatabases.mockResolvedValue([{ name: 'main' }]);
	mocks.listObjects.mockResolvedValue([{ schema: 'dbo', name: 'keep' }, { schema: 'dbo', name: 'skip' }]);
	mocks.ignoreSet.mockReturnValue(new Set(['dbo.skip']));
	mocks.isIgnored.mockImplementation((_set, _schema, name) => name === 'skip');
	mocks.listColumns.mockResolvedValue([{ name: 'id', type: 'int' }]);
	mocks.formatType.mockReturnValue('int');
	mocks.searchColumns.mockResolvedValue([{ name: 'id' }]);
	mocks.objectDefinition.mockResolvedValue('create table');
	mocks.dbProperties.mockResolvedValue({ name: 'main' });
	mocks.loadIgnoreList.mockReturnValue(['dbo.skip']);
	mocks.saveIgnoreList.mockReturnValue(['dbo.skip']);
	mocks.listRuns.mockReturnValue([{ id: 1 }]);
	mocks.countRuns.mockReturnValue(1);
	mocks.clearRuns.mockReturnValue(1);
	mocks.killBridgesFor.mockReturnValue(2);
	mocks.killBridge.mockReturnValue(true);
	mocks.loadDatamap.mockReturnValue({ generatedAt: 'today', tables: { 'dbo.a': { description: 'A' }, 'dbo.b': {} } });
	mocks.jobStatus.mockReturnValue({ running: false });
	mocks.startGenerate.mockReturnValue({ running: true });
	mocks.checkStale.mockResolvedValue({ stale: 1, total: 2 });
	mocks.askModelStatus.mockResolvedValue({ ok: true, model: 'test' });
});

describe('server and sheet endpoints', () => {
	it('handles connection listing, legacy creation, typed creation, errors, and deletion', async () => {
		expect(await data(await servers.GET(event()))).toEqual({ connections: [{ id: 's' }] });
		expect(await data(await servers.POST(event('http://test/', { name: ' legacy ' })))).toEqual({ connections: [{ id: 'legacy' }] });
		await servers.POST(event('http://test/', { name: 'sqlite', type: 'sqlite', path: 'a.db' }));
		expect(mocks.addConnection).toHaveBeenCalled();
		for (const body of [
			{}, { name: 'x', type: 'bad' }, { name: 'x', type: 'mssql' },
			{ name: 'x', type: 'postgres' }, { name: 'x', type: 'sqlite' }
		]) expect((await servers.POST(event('http://test/', body))).status).toBe(400);
		mocks.addConnection.mockImplementationOnce(() => { throw new Error('duplicate'); });
		expect(await data(await servers.POST(event('http://test/', { name: 'x', type: 'sqlite', path: 'x' })))).toEqual({ error: 'duplicate' });
		expect((await servers.DELETE(event('http://test/'))).status).toBe(400);
		expect(await data(await servers.DELETE(event('http://test/?name=legacy')))).toEqual({ connections: [] });
	});

	it('lists, creates, updates, and deletes sheets', async () => {
		await sheets.GET(event('http://test/?all=1'));
		expect(mocks.listSheets).toHaveBeenCalledWith({ includeClosed: true });
		expect(await data(await sheets.POST(event('http://test/', { name: 'New' })))).toEqual({ sheet: { id: 'new' } });
		expect(await data(await sheet.PUT(event('http://test/', { sql: 'x' }, { id: 'one' })))).toEqual({ sheet: { id: 'one' } });
		mocks.updateSheet.mockImplementationOnce(() => { throw new Error('missing'); });
		expect((await sheet.PUT(event('http://test/', {}, { id: 'missing' }))).status).toBe(404);
		expect(await data(await sheet.DELETE(event('http://test/', undefined, { id: 'one' })))).toEqual({ ok: true });
		expect(mocks.killBridge).toHaveBeenCalledWith('sheet:one');
	});
});

describe('metadata endpoints', () => {
	it('returns successful database, object, column, search, definition, and property payloads', async () => {
		expect(await data(await databases.GET(event('http://test/?server=s')))).toEqual({ databases: [{ name: 'main' }] });
		expect(await data(await objects.GET(event('http://test/?server=s&database=d')))).toEqual({ objects: [{ schema: 'dbo', name: 'keep' }] });
		await objects.GET(event('http://test/?server=s&database=d&all=1'));
		expect(mocks.ignoreSet).toHaveBeenCalledTimes(1);
		expect(await data(await columns.GET(event('http://test/?server=s&database=d&schema=dbo&table=t')))).toEqual({ columns: [{ name: 'id', type: 'int', display: 'int' }] });
		expect(await data(await columnsearch.GET(event('http://test/?server=s&database=d&q=i')))).toEqual({ columns: [{ name: 'id' }] });
		expect(await data(await definition.GET(event('http://test/?server=s&database=d&schema=dbo&name=t')))).toEqual({ definition: 'create table' });
		expect(await data(await properties.GET(event('http://test/?server=s&database=d')))).toEqual({ properties: { name: 'main' } });
	});

	it('validates parameters and converts metadata failures to 502 responses', async () => {
		for (const handler of [databases.GET, objects.GET, columns.GET, columnsearch.GET, definition.GET, properties.GET]) {
			expect((await handler(event('http://test/'))).status).toBe(400);
		}
		const cases = [
			[mocks.listDatabases, databases.GET, '?server=s'], [mocks.listObjects, objects.GET, '?server=s&database=d'],
			[mocks.listColumns, columns.GET, '?server=s&database=d&schema=x&table=t'], [mocks.searchColumns, columnsearch.GET, '?server=s&database=d'],
			[mocks.objectDefinition, definition.GET, '?server=s&database=d&schema=x&name=t'], [mocks.dbProperties, properties.GET, '?server=s&database=d']
		] as const;
		for (const [dependency, handler, query] of cases) {
			dependency.mockRejectedValueOnce(new Error('offline'));
			const response = await handler(event(`http://test/${query}`));
			expect(response.status).toBe(502);
			expect(await data(response)).toEqual({ error: 'offline' });
		}
	});
});

describe('settings, history, connection, and datamap endpoints', () => {
	it('loads and saves ignore lists with validation', async () => {
		expect((await ignore.GET(event('http://test/'))).status).toBe(400);
		expect(await data(await ignore.GET(event('http://test/?server=s&database=d')))).toEqual({ ignored: ['dbo.skip'] });
		expect((await ignore.PUT(event('http://test/', {}))).status).toBe(400);
		expect(await data(await ignore.PUT(event('http://test/', { server: 's', database: 'd', ignored: ['dbo.skip'] })))).toEqual({ ignored: ['dbo.skip'] });
	});

	it('lists and clears history, including storage failures and invalid limits', async () => {
		await history.GET(event('http://test/?limit=nope&q=find'));
		expect(mocks.listRuns).toHaveBeenCalledWith({ limit: 300, search: 'find' });
		expect(await data(await history.DELETE(event()))).toEqual({ cleared: 1 });
		mocks.listRuns.mockImplementationOnce(() => { throw new Error('read failed'); });
		expect((await history.GET(event())).status).toBe(500);
		mocks.clearRuns.mockImplementationOnce(() => { throw new Error('clear failed'); });
		expect((await history.DELETE(event())).status).toBe(500);
	});

	it('disconnects and cancels with validation', async () => {
		expect((await disconnect.POST(event('http://test/', {}))).status).toBe(400);
		expect(await data(await disconnect.POST(event('http://test/', { server: 's' })))).toEqual({ closed: 2 });
		expect(mocks.killBridgesFor).toHaveBeenCalledWith('s', undefined);
		expect((await cancel.POST(event('http://test/', {}))).status).toBe(400);
		expect(await data(await cancel.POST(event('http://test/', { sheetId: 'one' })))).toEqual({ cancelled: true });
	});

	it('reports datamap status, optional staleness, failures, and generation', async () => {
		expect((await datamap.GET(event('http://test/'))).status).toBe(400);
		expect(await data(await datamap.GET(event('http://test/?server=s&database=d&check=1')))).toEqual({
			exists: true, generatedAt: 'today', tableCount: 2, describedCount: 1,
			stale: { stale: 1, total: 2 }, job: { running: false }, ollama: { ok: true, model: 'test' }
		});
		mocks.checkStale.mockRejectedValueOnce(new Error('offline'));
		expect((await data(await datamap.GET(event('http://test/?server=s&database=d&check=1')))).stale).toBeNull();
		mocks.loadDatamap.mockReturnValueOnce(null);
		expect((await data(await datamap.GET(event('http://test/?server=s&database=d')))).exists).toBe(false);
		expect((await datamap.POST(event('http://test/', {}))).status).toBe(400);
		expect(await data(await datamap.POST(event('http://test/', { server: 's', database: 'd', force: 1 })))).toEqual({ job: { running: true } });
		expect(mocks.startGenerate).toHaveBeenCalledWith('s', 'd', true);
	});
});
