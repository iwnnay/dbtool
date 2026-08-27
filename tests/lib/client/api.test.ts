import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '$lib/client/api';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	}));
});

describe('database API client', () => {
	it('maps every operation to its endpoint, method, and encoded parameters', async () => {
		await api.connections();
		await api.addConnection({ name: 'Local DB', type: 'sqlite', path: 'a.db' });
		await api.removeConnection('a/b');
		await api.databases('server one');
		await api.objects('s&1', 'db name', true);
		await api.columnSearch('s', 'd', 'first name');
		await api.getIgnore('s', 'd');
		await api.saveIgnore('s', 'd', ['audit.log']);
		await api.definition('s', 'd', 'odd schema', 'a/b');
		await api.columns('s', 'd', 'dbo', 'users');
		await api.datamapStatus('s', 'd', true);
		await api.datamapGenerate('s', 'd', true);
		await api.askStatus();
		await api.history('drop %', 12);
		await api.clearHistory();
		await api.properties('s', 'd');
		await api.run({ sheetId: '1', server: 's', database: 'd', sql: 'select 1' });
		await api.disconnect('s', 'd');
		await api.cancel('sheet');
		await api.sheets();
		await api.savedSheets();
		await api.createSheet({ name: 'New' });
		await api.updateSheet('a/b', { sql: 'select 2' });
		await api.deleteSheet('sheet-1');

		const calls = fetchMock.mock.calls as [string, RequestInit][];
		expect(calls.map(([url]) => url)).toEqual([
			'/api/db/servers', '/api/db/servers', '/api/db/servers?id=a%2Fb',
			'/api/db/databases?server=server%20one',
			'/api/db/objects?server=s%261&database=db%20name&all=1',
			'/api/db/columnsearch?server=s&database=d&q=first%20name',
			'/api/db/ignore?server=s&database=d', '/api/db/ignore',
			'/api/db/definition?server=s&database=d&schema=odd%20schema&name=a%2Fb',
			'/api/db/columns?server=s&database=d&schema=dbo&table=users',
			'/api/db/datamap?server=s&database=d&check=1', '/api/db/datamap',
			'/api/db/ask', '/api/db/history?limit=12&q=drop%20%25', '/api/db/history',
			'/api/db/properties?server=s&database=d', '/api/db/run', '/api/db/disconnect',
			'/api/db/cancel', '/api/sheets', '/api/sheets?all=1', '/api/sheets',
			'/api/sheets/a/b', '/api/sheets/sheet-1'
		]);
		expect(calls.map(([, init]) => init.method ?? 'GET')).toEqual([
			'GET', 'POST', 'DELETE', 'GET', 'GET', 'GET', 'GET', 'PUT', 'GET', 'GET',
			'GET', 'POST', 'GET', 'GET', 'DELETE', 'GET', 'POST', 'POST', 'POST', 'GET',
			'GET', 'POST', 'PUT', 'DELETE'
		]);
		expect(calls[7][1].body).toBe(JSON.stringify({ server: 's', database: 'd', ignored: ['audit.log'] }));
		expect(calls.every(([, init]) => init.headers && (init.headers as Record<string, string>)['content-type'] === 'application/json')).toBe(true);
	});

	it('supports optional defaults and returns parsed JSON', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ databases: [{ name: 'main' }] }), { status: 200 }));
		await expect(api.databases('local')).resolves.toEqual({ databases: [{ name: 'main' }] });
		await api.objects('s', 'd');
		await api.datamapStatus('s', 'd');
		await api.history();
		await api.disconnect('s');
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			'/api/db/databases?server=local', '/api/db/objects?server=s&database=d',
			'/api/db/datamap?server=s&database=d', '/api/db/history?limit=300', '/api/db/disconnect'
		]);
	});

	it('uses a server error message and falls back when the body is invalid', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'No connection' }), { status: 400, statusText: 'Bad Request' }));
		await expect(api.connections()).rejects.toThrow('No connection');
		fetchMock.mockResolvedValueOnce(new Response('not json', { status: 503, statusText: 'Unavailable' }));
		await expect(api.connections()).rejects.toThrow('503 Unavailable');
	});
});
