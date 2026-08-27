import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlResultSet } from '$lib/client/api';

const mocks = vi.hoisted(() => ({
	writeText: vi.fn(), addWorksheet: vi.fn(), addRow: vi.fn(), getRow: vi.fn(), getColumn: vi.fn(),
	writeBuffer: vi.fn(), createElement: vi.fn(), createObjectURL: vi.fn(), revokeObjectURL: vi.fn(), click: vi.fn()
}));
vi.mock('exceljs', () => ({
	default: {
		Workbook: class {
			xlsx = { writeBuffer: mocks.writeBuffer };
			addWorksheet(name: string) { return mocks.addWorksheet(name); }
		}
	}
}));

import { copyRangeTsv, copyStackedTsv, copyTsv, exportXlsx } from '$lib/client/export';

const rs: SqlResultSet = {
	columns: [{ name: '', type: 'x' }, { name: 'created', type: 'datetime' }],
	rows: [[null, '2026-01-02T03:04:05Z'], ['long value', 'not-a-date'], ['x', '2026-99-99T99:99']],
	rowCount: 3, truncated: false
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
	const row = { font: {} };
	const columns = new Map<number, { width?: number }>();
	mocks.addWorksheet.mockReturnValue({
		addRow: mocks.addRow, getRow: mocks.getRow.mockReturnValue(row),
		getColumn: mocks.getColumn.mockImplementation((index) => columns.get(index) ?? columns.set(index, {}).get(index)),
		views: []
	});
	mocks.writeBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]));
	mocks.createElement.mockReturnValue({ href: '', download: '', click: mocks.click });
	vi.stubGlobal('document', { createElement: mocks.createElement });
	vi.stubGlobal('URL', { createObjectURL: mocks.createObjectURL.mockReturnValue('blob:test'), revokeObjectURL: mocks.revokeObjectURL });
});

describe('export actions', () => {
	it('writes whole, range, and stacked TSV text to the clipboard', async () => {
		await copyTsv(rs, true);
		await copyRangeTsv(rs, { top: 0, bottom: 0, left: 1, right: 1 }, false);
		await copyStackedTsv([rs, rs], false);
		expect(mocks.writeText).toHaveBeenNthCalledWith(1, '\tcreated\r\n\t2026-01-02T03:04:05Z\r\nlong value\tnot-a-date\r\nx\t2026-99-99T99:99');
		expect(mocks.writeText).toHaveBeenNthCalledWith(2, '2026-01-02T03:04:05Z');
		expect(mocks.writeText.mock.calls[2][0]).toContain('\r\n\r\n');
	});

	it('builds worksheets, converts valid dates, sizes columns, and downloads a safe filename', async () => {
		await exportXlsx([rs, rs], 'bad/name:*');
		expect(mocks.addWorksheet).toHaveBeenNthCalledWith(1, 'Results 1');
		expect(mocks.addWorksheet).toHaveBeenNthCalledWith(2, 'Results 2');
		expect(mocks.addRow).toHaveBeenCalledWith(['(col 1)', 'created']);
		expect(mocks.addRow.mock.calls.some(([row]) => row[0] === null && row[1] instanceof Date)).toBe(true);
		expect(mocks.click).toHaveBeenCalled();
		expect(mocks.createElement.mock.results[0].value.download).toBe('bad_name__.xlsx');
		expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:test');
	});

	it('uses the single-sheet and default filename variants', async () => {
		await exportXlsx([rs], '');
		expect(mocks.addWorksheet).toHaveBeenCalledWith('Results');
		expect(mocks.createElement.mock.results[0].value.download).toBe('results.xlsx');
	});
});
