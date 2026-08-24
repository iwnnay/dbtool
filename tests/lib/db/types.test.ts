import { describe, expect, it } from 'vitest';
import { qualifyObject, quoteIdentifier, sampleSelect } from '$lib/db/types';

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
});
