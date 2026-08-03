import { describe, expect, it } from 'vitest';
import { allStatements, splitBatches, splitStatements, statementAt } from './split';

describe('splitBatches', () => {
	it('returns whole text as one batch without GO', () => {
		const b = splitBatches('SELECT 1\nSELECT 2');
		expect(b).toHaveLength(1);
	});

	it('splits on GO lines, case-insensitive, with counts', () => {
		const b = splitBatches('SELECT 1\nGO\nSELECT 2\ngo 5\nSELECT 3');
		expect(b.map((x) => x.text)).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
	});

	it('does not split on GO inside a string or mid-line', () => {
		const b = splitBatches("SELECT 'GO' AS g\nSELECT 2 GO");
		expect(b).toHaveLength(1);
	});
});

describe('splitStatements', () => {
	it('splits on semicolons', () => {
		const s = splitStatements('SELECT 1;\nSELECT 2;');
		expect(s.map((x) => x.text)).toEqual(['SELECT 1', 'SELECT 2']);
	});

	it('ignores semicolons in strings, comments, brackets', () => {
		const sql = `SELECT ';' AS a -- trailing; comment
FROM [weird;name]; SELECT /* ; */ 2`;
		const s = splitStatements(sql);
		expect(s).toHaveLength(2);
		expect(s[1].text).toContain('SELECT /* ; */ 2');
	});

	it('handles escaped quotes', () => {
		const s = splitStatements("SELECT 'it''s; fine'; SELECT 2");
		expect(s).toHaveLength(2);
	});

	it('keeps offsets into the original text', () => {
		const sql = 'SELECT 1;  SELECT 2';
		const s = splitStatements(sql);
		expect(sql.slice(s[1].start, s[1].end)).toBe('SELECT 2');
	});
});

describe('statementAt', () => {
	const sql = 'SELECT 1;\n\nSELECT 2;\n\nSELECT 3';

	it('finds the statement containing the cursor', () => {
		expect(statementAt(sql, 3)?.text).toBe('SELECT 1');
		expect(statementAt(sql, sql.indexOf('SELECT 2') + 2)?.text).toBe('SELECT 2');
	});

	it('falls back to the preceding statement on a blank line', () => {
		expect(statementAt(sql, sql.indexOf('\n\nSELECT 3') + 1)?.text).toBe('SELECT 2');
	});

	it('returns null for empty text', () => {
		expect(statementAt('   ', 1)).toBeNull();
	});

	it('is batch-aware', () => {
		const s = allStatements('SELECT 1\nGO\nSELECT 2');
		expect(s.map((x) => x.text)).toEqual(['SELECT 1', 'SELECT 2']);
	});
});
