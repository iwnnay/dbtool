export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
	column: number;
	direction: SortDirection;
}

export interface IndexedRow {
	row: unknown[];
	originalIndex: number;
}

export interface CellMatch {
	row: number;
	col: number;
}

function compareValues(left: unknown, right: unknown): number {
	if (left == null && right == null) return 0;
	if (left == null) return 1;
	if (right == null) return -1;
	if (typeof left === 'number' && typeof right === 'number') return left - right;
	if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
	const a = String(left);
	const b = String(right);
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortRows(rows: unknown[][], specs: SortSpec[]): IndexedRow[] {
	const indexed = rows.map((row, originalIndex) => ({ row, originalIndex }));
	if (specs.length === 0) return indexed;
	return indexed.sort((left, right) => {
		for (const spec of specs) {
			const compared = compareValues(left.row[spec.column], right.row[spec.column]);
			if (compared !== 0) return spec.direction === 'asc' ? compared : -compared;
		}
		return left.originalIndex - right.originalIndex;
	});
}

export function nextSort(specs: SortSpec[], column: number, additive: boolean): SortSpec[] {
	const current = specs.find((spec) => spec.column === column);
	const nextDirection = !current ? 'asc' : current.direction === 'asc' ? 'desc' : null;
	if (!additive) return nextDirection ? [{ column, direction: nextDirection }] : [];
	if (!current) return [...specs, { column, direction: 'asc' }];
	if (!nextDirection) return specs.filter((spec) => spec.column !== column);
	return specs.map((spec) => spec.column === column ? { ...spec, direction: nextDirection } : spec);
}

export function findCells(rows: IndexedRow[], query: string): CellMatch[] {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return [];
	const matches: CellMatch[] = [];
	for (let row = 0; row < rows.length; row++) {
		for (let col = 0; col < rows[row].row.length; col++) {
			const value = rows[row].row[col];
			const text = value == null ? 'null' : String(value).toLocaleLowerCase();
			if (text.includes(needle)) matches.push({ row, col });
		}
	}
	return matches;
}
