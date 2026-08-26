import { describe, expect, it } from 'vitest';
import { findCells, nextSort, sortRows } from '$lib/client/resultGrid';

describe('result grid sorting', () => {
	const rows = [[2, 'Beta'], [1, 'alpha'], [2, 'Alpha'], [null, 'last']];

	it('cycles unsorted, ascending, descending, and unsorted', () => {
		const asc = nextSort([], 0, false);
		expect(asc).toEqual([{ column: 0, direction: 'asc' }]);
		const desc = nextSort(asc, 0, false);
		expect(desc).toEqual([{ column: 0, direction: 'desc' }]);
		expect(nextSort(desc, 0, false)).toEqual([]);
	});

	it('supports stable multi-column sorting', () => {
		const specs = nextSort(nextSort([], 0, false), 1, true);
		const sorted = sortRows(rows, specs);
		expect(sorted.map(({ originalIndex }) => originalIndex)).toEqual([1, 2, 0, 3]);
	});

	it('removes one multi-sort column without disturbing the others', () => {
		const specs = [{ column: 0, direction: 'asc' as const }, { column: 1, direction: 'desc' as const }];
		const toggled = nextSort(specs, 1, true);
		expect(toggled).toEqual([{ column: 0, direction: 'asc' }]);
	});

	it('keeps sort priority when changing an existing secondary direction', () => {
		const specs = [{ column: 0, direction: 'asc' as const }, { column: 1, direction: 'asc' as const }];
		expect(nextSort(specs, 1, true)).toEqual([
			{ column: 0, direction: 'asc' },
			{ column: 1, direction: 'desc' }
		]);
	});

	it('does not mutate the source rows and restores original order without specs', () => {
		const original = rows.map((row) => [...row]);
		const indexed = sortRows(rows, []);
		expect(indexed.map(({ originalIndex }) => originalIndex)).toEqual([0, 1, 2, 3]);
		expect(rows).toEqual(original);
	});

	it('sorts numbers, booleans, nulls, and natural strings', () => {
		expect(sortRows([[10], [2]], [{ column: 0, direction: 'asc' }]).map((entry) => entry.row[0])).toEqual([2, 10]);
		expect(sortRows([[true], [false]], [{ column: 0, direction: 'asc' }]).map((entry) => entry.row[0])).toEqual([false, true]);
		expect(sortRows([['item10'], ['item2']], [{ column: 0, direction: 'asc' }]).map((entry) => entry.row[0])).toEqual(['item2', 'item10']);
		expect(sortRows([[null], [1]], [{ column: 0, direction: 'asc' }]).map((entry) => entry.row[0])).toEqual([1, null]);
		expect(sortRows([[null], [1]], [{ column: 0, direction: 'desc' }]).map((entry) => entry.row[0])).toEqual([null, 1]);
	});

	it('uses later columns and then original order to break ties', () => {
		const tied = [['same', 2], ['same', 1], ['same', 1]];
		const sorted = sortRows(tied, [
			{ column: 0, direction: 'asc' },
			{ column: 1, direction: 'asc' }
		]);
		expect(sorted.map(({ originalIndex }) => originalIndex)).toEqual([1, 2, 0]);
	});

	it('keeps null ties stable', () => {
		const sorted = sortRows([[null, 'first'], [null, 'second']], [{ column: 0, direction: 'asc' }]);
		expect(sorted.map(({ originalIndex }) => originalIndex)).toEqual([0, 1]);
	});
});

describe('result grid search', () => {
	it('searches every cell case-insensitively and includes NULL', () => {
		const rows = sortRows([['Alpha', 1], ['beta', null], ['alphabet', 2]], []);
		expect(findCells(rows, 'ALP')).toEqual([{ row: 0, col: 0 }, { row: 2, col: 0 }]);
		expect(findCells(rows, 'null')).toEqual([{ row: 1, col: 1 }]);
	});

	it('returns no matches for blank input', () => {
		const rows = sortRows([['anything']], []);
		expect(findCells(rows, '')).toEqual([]);
		expect(findCells(rows, '   ')).toEqual([]);
	});

	it('matches numbers and booleans in row-major order', () => {
		const rows = sortRows([[true, 123], [false, 3123]], []);
		expect(findCells(rows, 'true')).toEqual([{ row: 0, col: 0 }]);
		expect(findCells(rows, '123')).toEqual([{ row: 0, col: 1 }, { row: 1, col: 1 }]);
	});
});
