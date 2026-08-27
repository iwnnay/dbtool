import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '$lib/client/api';
import { bracket, catalog } from '$lib/client/catalog.svelte';

beforeEach(() => {
	catalog.databases = {};
	catalog.objects = {};
	catalog.columns = {};
	catalog.loading = {};
	catalog.errors = {};
	vi.restoreAllMocks();
});

describe('catalog cache', () => {
	it('loads and caches databases, with optional forced refresh', async () => {
		const fetch = vi.spyOn(api, 'databases')
			.mockResolvedValueOnce({ databases: [{ name: 'one', isSystem: false }] })
			.mockResolvedValueOnce({ databases: [{ name: 'two', isSystem: false }] });
		expect(await catalog.loadDatabases('s')).toEqual([{ name: 'one', isSystem: false }]);
		expect(await catalog.loadDatabases('s')).toEqual([{ name: 'one', isSystem: false }]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await catalog.loadDatabases('s', true)).toEqual([{ name: 'two', isSystem: false }]);
	});

	it('loads object and column keys and clears stale errors', async () => {
		vi.spyOn(api, 'objects').mockResolvedValue({ objects: [{ schema: 'dbo', name: 't', type: 'table' }] });
		vi.spyOn(api, 'columns').mockResolvedValue({ columns: [{ name: 'id', type: 'int', display: 'int', maxLength: 4, precision: 10, scale: 0, nullable: false, identity: true, computed: false, isPk: true }] });
		catalog.errors['s|d'] = 'old';
		expect(await catalog.loadObjects('s', 'd')).toHaveLength(1);
		expect(catalog.errors['s|d']).toBeUndefined();
		expect(await catalog.loadColumns('s', 'd', 'dbo', 't')).toHaveLength(1);
		expect(catalog.objects['s|d'][0].name).toBe('t');
		expect(catalog.columns['s|d|dbo|t'][0].name).toBe('id');
	});

	it('returns null during an in-flight load and records failures', async () => {
		let resolve!: (value: { databases: [] }) => void;
		vi.spyOn(api, 'databases').mockReturnValue(new Promise((done) => { resolve = done; }));
		const first = catalog.loadDatabases('slow');
		expect(await catalog.loadDatabases('slow')).toBeNull();
		resolve({ databases: [] });
		await first;
		expect(catalog.loading.slow).toBe(false);

		vi.spyOn(api, 'objects').mockRejectedValueOnce(new Error('offline'));
		expect(await catalog.loadObjects('s', 'bad')).toBeNull();
		expect(catalog.errors['s|bad']).toBe('offline');
		expect(catalog.loading['s|bad']).toBe(false);
	});

	it('brackets unsafe identifiers and escapes closing brackets', () => {
		expect(bracket('safe_name')).toBe('safe_name');
		expect(bracket('odd name]')).toBe('[odd name]]]');
	});
});
