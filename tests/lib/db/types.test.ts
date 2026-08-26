import { describe, expect, it } from 'vitest';
import { CAPABILITIES, defaultDatabase, qualifyObject, quoteIdentifier, sampleSelect } from '$lib/db/types';

describe('database dialect helpers', () => {
	it('quotes identifiers for each family', () => {
		expect(quoteIdentifier('mssql', 'odd]name')).toBe('[odd]]name]');
		expect(quoteIdentifier('postgres', 'odd"name')).toBe('"odd""name"');
		expect(quoteIdentifier('sqlite', 'select')).toBe('"select"');
	});

	it('builds dialect-correct sample queries', () => {
		expect(sampleSelect('mssql', 'dbo', 'People', 100)).toContain('SELECT TOP (100)');
		expect(sampleSelect('postgres', 'public', 'People', 100)).toContain('LIMIT 100');
		expect(sampleSelect('sqlite', 'main', 'People', 100)).toContain('FROM "People"');
	});

	it('only uses cross-database qualification for SQL Server', () => {
		expect(qualifyObject('mssql', 'dbo', 'T', 'Other')).toBe('Other.dbo.T');
		expect(qualifyObject('postgres', 'public', 'T', 'Other')).toBe('public."T"');
		expect(qualifyObject('sqlite', 'main', 'T')).toBe('"T"');
	});

	it('chooses the correct metadata database for each profile', () => {
		expect(defaultDatabase({ id: 'm', name: 'M', type: 'mssql', server: '.' })).toBe('master');
		expect(defaultDatabase({ id: 'p', name: 'P', type: 'postgres', host: 'localhost', port: 5432, user: 'me', database: 'app' })).toBe('app');
		expect(defaultDatabase({ id: 'p', name: 'P', type: 'postgres', host: 'localhost', port: 5432, user: 'me' })).toBe('postgres');
		expect(defaultDatabase({ id: 's', name: 'S', type: 'sqlite', path: 'app.db' })).toBe('main');
	});

	it('leaves safe identifiers bare and quotes engine-specific edge cases', () => {
		expect(quoteIdentifier('mssql', 'OrderId')).toBe('OrderId');
		expect(quoteIdentifier('postgres', 'order_id')).toBe('order_id');
		expect(quoteIdentifier('postgres', 'OrderId')).toBe('"OrderId"');
		expect(quoteIdentifier('sqlite', 'order_id')).toBe('order_id');
		expect(quoteIdentifier('sqlite', 'order')).toBe('"order"');
	});

	it('qualifies attached SQLite databases but omits main', () => {
		expect(qualifyObject('sqlite', 'main', 'items')).toBe('items');
		expect(qualifyObject('sqlite', 'archive', 'items')).toBe('archive.items');
	});

	it('publishes capabilities used to hide unsupported UI', () => {
		expect(CAPABILITIES.mssql.procedures).toBe(true);
		expect(CAPABILITIES.postgres.schemas).toBe(true);
		expect(CAPABILITIES.sqlite).toMatchObject({ listDatabases: false, schemas: false, procedures: false });
	});
});
