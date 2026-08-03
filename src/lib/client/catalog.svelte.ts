/**
 * Shared, reactive catalog cache: databases per server, objects per database,
 * columns per table. Fed by the explorer tree, the editor's autocomplete, and
 * the table context-menu modals — whoever asks first populates it for everyone.
 *
 * Keys: server · `server|db` · `server|db|schema|table`.
 */
import { api, type ColumnInfo, type DatabaseInfo, type DbObject } from './api';

class Catalog {
	databases = $state<Record<string, DatabaseInfo[]>>({});
	objects = $state<Record<string, DbObject[]>>({});
	columns = $state<Record<string, ColumnInfo[]>>({});
	loading = $state<Record<string, boolean>>({});
	errors = $state<Record<string, string>>({});

	private async load<T>(
		key: string,
		cache: Record<string, T>,
		fetcher: () => Promise<T>,
		force: boolean
	): Promise<T | null> {
		if (!force && cache[key]) return cache[key];
		if (this.loading[key]) return null;
		this.loading[key] = true;
		delete this.errors[key];
		try {
			cache[key] = await fetcher();
			return cache[key];
		} catch (e) {
			this.errors[key] = (e as Error).message;
			return null;
		} finally {
			this.loading[key] = false;
		}
	}

	loadDatabases(server: string, force = false) {
		return this.load(server, this.databases, async () => (await api.databases(server)).databases, force);
	}

	loadObjects(server: string, db: string, force = false) {
		return this.load(
			`${server}|${db}`,
			this.objects,
			async () => (await api.objects(server, db)).objects,
			force
		);
	}

	loadColumns(server: string, db: string, schema: string, table: string, force = false) {
		return this.load(
			`${server}|${db}|${schema}|${table}`,
			this.columns,
			async () => (await api.columns(server, db, schema, table)).columns,
			force
		);
	}
}

export const catalog = new Catalog();

export function bracket(n: string): string {
	return /^[a-z_][a-z0-9_]*$/i.test(n) ? n : `[${n.replace(/]/g, ']]')}]`;
}
