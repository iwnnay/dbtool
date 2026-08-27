import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { sql, MSSQL } from '@codemirror/lang-sql';
import { api } from '$lib/client/api';
import { catalog } from '$lib/client/catalog.svelte';
import { columnCompletionSource } from '$lib/client/columnCompletion';

function context(source: string, explicit = false): CompletionContext {
	const pos = source.indexOf('|');
	const state = EditorState.create({ doc: source.replace('|', ''), extensions: sql({ dialect: MSSQL }) });
	return new CompletionContext(state, pos, explicit);
}

beforeEach(() => {
	catalog.objects = {};
	catalog.columns = {};
	catalog.errors = {};
	catalog.loading = {};
	vi.restoreAllMocks();
});

describe('column completion source', () => {
	it('does nothing in comments, without a connection, or without an activation token', async () => {
		expect(await columnCompletionSource(() => ({ server: 's', database: 'd' }))(context('SELECT -- hi|'))).toBeNull();
		expect(await columnCompletionSource(() => ({ server: '', database: 'd' }))(context('SELECT na|'))).toBeNull();
		expect(await columnCompletionSource(() => ({ server: 's', database: 'd' }))(context('SELECT |'))).toBeNull();
	});

	it('offers cached table/view names, filters procedures, and supports schema qualifiers', async () => {
		const objects = [
			{ schema: 'dbo', name: 'people', type: 'table' as const },
			{ schema: 'sales', name: 'orders', type: 'view' as const },
			{ schema: 'dbo', name: 'refresh', type: 'procedure' as const }
		];
		const load = vi.spyOn(catalog, 'loadObjects').mockResolvedValue(objects);
		const source = columnCompletionSource(() => ({ server: 's', database: 'd' }));
		let result = await source(context('SELECT * FROM pe|'));
		expect(result?.options.map((option) => option.label)).toEqual(['people', 'orders']);
		expect(result?.options[1]).toEqual(expect.objectContaining({ type: 'interface', apply: 'sales.orders' }));
		result = await source(context('SELECT * FROM sales.or|'));
		expect(result?.options).toEqual([expect.objectContaining({ label: 'orders', detail: 'view' })]);
		await source(context('SELECT * FROM peo|'));
		expect(load).toHaveBeenCalledTimes(3);
	});

	it('offers columns from referenced tables, aliases, alternate databases, and cached fallback data', async () => {
		const load = vi.spyOn(catalog, 'loadColumns').mockImplementation(async (_server, db, schema, table) => [{
			name: 'name', type: 'text', display: 'text', maxLength: 0, precision: 0, scale: 0,
			nullable: true, identity: false, computed: false, isPk: false
		}]);
		const source = columnCompletionSource(() => ({ server: 's', database: 'd', engine: 'postgres' }));
		let result = await source(context('SELECT p.na| FROM other.public.people p'));
		expect(result?.options).toEqual([expect.objectContaining({ label: 'name', detail: 'p · text' })]);
		expect(load).toHaveBeenCalledWith('s', 'other', 'public', 'people');

		result = await source(context('SELECT na| FROM people'));
		expect(result?.options[0].detail).toBe('people · text');
		expect(load).toHaveBeenLastCalledWith('s', 'd', 'public', 'people');
	});

	it('skips known-bad references and uses cached columns when a load returns null', async () => {
		const key = 's|d|dbo|people';
		catalog.errors[key] = 'missing';
		let source = columnCompletionSource(() => ({ server: 's', database: 'd' }));
		expect(await source(context('SELECT na| FROM dbo.people'))).toBeNull();

		delete catalog.errors[key];
		catalog.columns[key] = [{ name: 'cached', type: 'int', display: 'int', maxLength: 4, precision: 0, scale: 0, nullable: true, identity: false, computed: false, isPk: false }];
		vi.spyOn(catalog, 'loadColumns').mockResolvedValue(null);
		source = columnCompletionSource(() => ({ server: 's', database: 'd' }));
		expect((await source(context('SELECT ca| FROM dbo.people')))?.options[0].label).toBe('cached');
	});

	it('falls back to prefix search, caches results, and formats count details', async () => {
		const search = vi.spyOn(api, 'columnSearch').mockResolvedValue({ columns: [
			{ name: 'person_id', count: 3, example: 'dbo.people', type: 'int' },
			{ name: 'person_name', count: 1, example: 'dbo.people', type: 'varchar' }
		] });
		const source = columnCompletionSource(() => ({ server: 's', database: 'd', engine: 'sqlite' }));
		let result = await source(context('SELECT pe|'));
		expect(result).toEqual(expect.objectContaining({ from: 7 }));
		expect(result).not.toHaveProperty('validFor');
		expect(result?.options.map((option) => option.detail)).toEqual(['3 tables', 'dbo.people · varchar']);
		await source(context('SELECT pe|'));
		expect(search).toHaveBeenCalledTimes(1);
	});

	it('supports explicit empty-prefix search and returns null when providers have no options', async () => {
		vi.spyOn(api, 'columnSearch').mockResolvedValue({ columns: [] });
		const source = columnCompletionSource(() => ({ server: 's2', database: 'd2' }));
		expect(await source(context('SELECT |', true))).toBeNull();
	});
});
