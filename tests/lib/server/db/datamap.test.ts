import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const files = new Map<string, string>();
	return {
		files,
		fs: {
			readFileSync: vi.fn((path: unknown) => {
				const value = files.get(String(path));
				if (value == null) throw new Error('ENOENT');
				return value;
			}),
			mkdirSync: vi.fn(),
			writeFileSync: vi.fn((path: unknown, value: unknown) => files.set(String(path), String(value)))
		},
		env: { DATAMAP_DESCRIBE_LIMIT: '300' },
		flowRun: vi.fn(), ensureBridge: vi.fn(), query: vi.fn(), getConnection: vi.fn(),
		listObjects: vi.fn(), listColumns: vi.fn(), tableDetail: vi.fn(), formatType: vi.fn(),
		ignoreSet: vi.fn(), isIgnored: vi.fn()
	};
});

vi.mock('node:fs', () => ({ default: mocks.fs }));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('nacelle-core/server', () => ({ FlowService: class { run(...args: unknown[]) { return mocks.flowRun(...args); } } }));
vi.mock('$lib/server/db/bridgeManager', () => ({ ensureBridge: mocks.ensureBridge }));
vi.mock('$lib/server/store', () => ({ getConnection: mocks.getConnection }));
vi.mock('$lib/server/db/meta', () => ({
	listObjects: mocks.listObjects, listColumns: mocks.listColumns,
	tableDetail: mocks.tableDetail, formatType: mocks.formatType
}));
vi.mock('$lib/server/ignore', () => ({ ignoreSet: mocks.ignoreSet, isIgnored: mocks.isIgnored }));

import { buildAskContext, checkStale, jobStatus, loadDatamap, startGenerate, type Datamap } from '$lib/server/db/datamap';

const table = (name: string, rowCount = 1, hash = `hash-${name}`) => ({
	schema: 'dbo', name, rowCount, pk: name === 'people' ? 'id' : null,
	columns: `id int, ${name}_name text`, hash
});

beforeEach(() => {
	mocks.files.clear();
	vi.clearAllMocks();
	mocks.env.DATAMAP_DESCRIBE_LIMIT = '300';
	mocks.getConnection.mockReturnValue({ id: 'lite', name: 'Lite', type: 'sqlite', path: 'x' });
	mocks.ensureBridge.mockResolvedValue({ query: mocks.query });
	mocks.ignoreSet.mockReturnValue(new Set());
	mocks.isIgnored.mockReturnValue(false);
	mocks.listObjects.mockResolvedValue([{ schema: 'main', name: 'people', type: 'table' }, { schema: 'main', name: 'report', type: 'view' }]);
	mocks.listColumns.mockResolvedValue([{ name: 'id', type: 'integer', isPk: true }]);
	mocks.tableDetail.mockResolvedValue({ rowCount: 9 });
	mocks.formatType.mockReturnValue('integer');
	mocks.flowRun.mockResolvedValue({ raw: '- main.people: Stores people\ninvalid line\n- other.nope: ignored' });
});

function mapFile(server: string, database: string): string {
	return [...mocks.files.keys()].find((path) => path.endsWith(`${server}__${database}.json`))
		?? `${process.cwd()}\\data\\datamaps\\${server}__${database}.json`;
}

describe('datamap loading and snapshots', () => {
	it('returns null for missing or corrupt maps and loads valid maps', () => {
		expect(loadDatamap('s', 'd')).toBeNull();
		mocks.files.set(mapFile('s', 'd'), '{bad');
		expect(loadDatamap('s', 'd')).toBeNull();
		const map = { server: 's', database: 'd', generatedAt: 'now', tables: {} };
		mocks.files.set(mapFile('s', 'd'), JSON.stringify(map));
		expect(loadDatamap('s', 'd')).toEqual(map);
	});

	it('builds non-SQL Server snapshots, filters objects, and detects staleness', async () => {
		mocks.listObjects.mockResolvedValue([
			{ schema: 'main', name: 'people', type: 'table' },
			{ schema: 'main', name: 'hidden', type: 'table' },
			{ schema: 'main', name: 'report', type: 'view' }
		]);
		mocks.isIgnored.mockImplementation((_set, _schema, name) => name === 'hidden');
		expect(await checkStale('lite', 'main')).toEqual({ stale: 1, total: 1 });
		expect(mocks.listColumns).toHaveBeenCalledTimes(1);

		const generated = startGenerate('lite', 'stored', true);
		await vi.waitFor(() => expect(generated.phase).toBe('done'));
		const stored = loadDatamap('lite', 'stored')!;
		expect(stored.tables['main.people']).toEqual(expect.objectContaining({ rowCount: 9, pk: 'id', description: 'Stores people' }));
		expect(mocks.flowRun).toHaveBeenCalledWith('describe_tables_flow', expect.objectContaining({ tables: expect.stringContaining('main.people') }), null, { record: false });

		expect(await checkStale('lite', 'stored')).toEqual({ stale: 0, total: 1 });
		mocks.listColumns.mockResolvedValueOnce([{ name: 'changed', type: 'text', isPk: false }]);
		expect(await checkStale('lite', 'stored')).toEqual({ stale: 1, total: 1 });
	});

	it('builds SQL Server snapshots, brackets names, filters rows, and reports failures', async () => {
		mocks.getConnection.mockReturnValue({ id: 'ms', name: 'MS', type: 'mssql', server: '.' });
		mocks.query.mockResolvedValueOnce({ ok: true, resultSets: [{ rows: [
			['dbo', 'people', 20, 'id', 'id int'], ['dbo', 'hidden', 2, null, null]
		] }] });
		mocks.isIgnored.mockImplementation((_set, _schema, name) => name === 'hidden');
		expect(await checkStale('ms', 'odd]db')).toEqual({ stale: 1, total: 1 });
		expect(mocks.query.mock.calls[0][0]).toContain('[odd]]db]');
		expect(mocks.query).toHaveBeenCalledWith(expect.any(String), { maxRows: 50_000, timeout: 300 });

		mocks.query.mockResolvedValueOnce({ ok: false, error: 'denied' });
		await expect(checkStale('ms', 'd')).rejects.toThrow('denied');
		mocks.query.mockResolvedValueOnce({ ok: false });
		await expect(checkStale('ms', 'd')).rejects.toThrow('schema snapshot failed');
	});

	it('rejects unknown connections', async () => {
		mocks.getConnection.mockReturnValue(null);
		await expect(checkStale('missing', 'd')).rejects.toThrow('Unknown connection: missing');
	});
});

describe('datamap generation jobs', () => {
	it('reuses a running job and preserves unchanged descriptions incrementally', async () => {
		mocks.flowRun.mockImplementation(() => new Promise(() => {}));
		const running = startGenerate('lite', 'running', true);
		await vi.waitFor(() => expect(running.phase).toBe('describe'));
		expect(startGenerate('lite', 'running')).toBe(running);

		mocks.flowRun.mockResolvedValue({ raw: '' });
		const prior: Datamap = {
			server: 'lite', database: 'incremental', generatedAt: 'old',
			tables: { 'main.people': { schema: 'main', name: 'people', rowCount: 1, pk: 'id', columns: 'id integer', hash: '', description: 'Keep me' } }
		};
		mocks.files.set(mapFile('lite', 'incremental'), JSON.stringify(prior));
		const job = startGenerate('lite', 'incremental');
		await vi.waitFor(() => expect(job.phase).toBe('done'));
		expect(jobStatus('lite', 'incremental')).toBe(job);
		expect(job.running).toBe(false);
	});

	it('honors a zero description limit and records background errors', async () => {
		mocks.env.DATAMAP_DESCRIBE_LIMIT = '0';
		const noDescriptions = startGenerate('lite', 'none', true);
		await vi.waitFor(() => expect(noDescriptions.phase).toBe('done'));
		expect(noDescriptions.total).toBe(0);

		mocks.getConnection.mockReturnValue(null);
		const failed = startGenerate('bad', 'db', true);
		await vi.waitFor(() => expect(failed.phase).toBe('error'));
		expect(failed).toEqual(expect.objectContaining({ running: false, error: 'Unknown connection: bad' }));
		expect(jobStatus('never', 'created')).toBeNull();
	});
});

describe('Ask context building', () => {
	it('orders relevant tables first, includes descriptions, filters ignores, and caps output', () => {
		const map: Datamap = {
			server: 's', database: 'app', generatedAt: 'today',
			tables: {
				'dbo.large': table('large', 1000),
				'dbo.people': { ...table('people', 10), description: 'Customer person records' },
				'dbo.hidden': table('hidden', 999)
			}
		};
		mocks.isIgnored.mockImplementation((_set, _schema, name) => name === 'hidden');
		const full = buildAskContext(map, 'Can you query all customer people?');
		expect(full).toContain('# Full Table Catalog');
		expect(full.indexOf('dbo.people')).toBeLessThan(full.indexOf('dbo.large'));
		expect(full).toContain('PK(id)');
		expect(full).toContain('^ Customer person records');
		expect(full).not.toContain('dbo.hidden');

		const capped = buildAskContext(map, 'irrelevant', 1);
		expect(capped).toContain('0 of 2 tables');
	});
});
