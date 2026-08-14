import { describe, expect, it } from 'vitest';
import { rangeTsv, stackedTsv, toTsv } from './export';
import type { SqlResultSet } from './api';

function makeResultSet(columnNames: string[], rows: unknown[][]): SqlResultSet {
	return {
		columns: columnNames.map((name) => ({ name, type: 'varchar' })),
		rows,
		rowCount: rows.length,
		truncated: false
	};
}

const people = makeResultSet(
	['id', 'name', 'city'],
	[
		[1, 'Ada', 'London'],
		[2, 'Grace', 'New York'],
		[3, 'Alan', 'Wilmslow']
	]
);

describe('rangeTsv', () => {
	it('copies a rectangular block without headers', () => {
		const tsv = rangeTsv(people, { top: 0, bottom: 1, left: 1, right: 2 }, false);
		expect(tsv).toBe('Ada\tLondon\r\nGrace\tNew York');
	});

	it('includes only the selected columns in the header row', () => {
		const tsv = rangeTsv(people, { top: 1, bottom: 1, left: 1, right: 2 }, true);
		expect(tsv).toBe('name\tcity\r\nGrace\tNew York');
	});

	it('copies a single cell', () => {
		expect(rangeTsv(people, { top: 2, bottom: 2, left: 0, right: 0 }, false)).toBe('3');
	});

	it('copies a whole column selection', () => {
		const tsv = rangeTsv(people, { top: 0, bottom: 2, left: 2, right: 2 }, true);
		expect(tsv).toBe('city\r\nLondon\r\nNew York\r\nWilmslow');
	});

	it('matches toTsv when the range covers everything', () => {
		const whole = { top: 0, bottom: people.rows.length - 1, left: 0, right: people.columns.length - 1 };
		expect(rangeTsv(people, whole, true)).toBe(toTsv(people, true));
	});

	it('renders null as an empty field and flattens tabs and newlines', () => {
		const messy = makeResultSet(['note'], [[null], ['a\tb'], ['line1\r\nline2']]);
		const tsv = rangeTsv(messy, { top: 0, bottom: 2, left: 0, right: 0 }, false);
		expect(tsv).toBe('\r\na b\r\nline1 line2');
	});

	it('skips rows past the end of the result set', () => {
		const tsv = rangeTsv(people, { top: 2, bottom: 99, left: 0, right: 0 }, false);
		expect(tsv).toBe('3');
	});

	it('returns headers only for an empty result set', () => {
		const empty = makeResultSet(['id', 'name'], []);
		expect(rangeTsv(empty, { top: 0, bottom: 0, left: 0, right: 1 }, true)).toBe('id\tname');
		expect(rangeTsv(empty, { top: 0, bottom: 0, left: 0, right: 1 }, false)).toBe('');
	});
});

describe('stackedTsv', () => {
	const totals = makeResultSet(['total'], [[42]]);

	it('separates result sets with a blank line', () => {
		expect(stackedTsv([totals, totals], false)).toBe('42\r\n\r\n42');
	});

	it('gives every result set its own header row', () => {
		const tsv = stackedTsv([makeResultSet(['a'], [[1]]), makeResultSet(['b'], [[2]])], true);
		expect(tsv).toBe('a\r\n1\r\n\r\nb\r\n2');
	});

	it('returns an empty string when there are no result sets', () => {
		expect(stackedTsv([], true)).toBe('');
	});
});
