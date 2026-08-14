/** Result-set export: copy as TSV (with/without headers) and Excel download. */
import type { SqlResultSet } from './api';
import type { CellValue } from 'exceljs';

function cellText(v: unknown): string {
	if (v == null) return '';
	const s = typeof v === 'string' ? v : String(v);
	// TSV has no quoting convention — flatten the separators instead.
	return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

export function toTsv(rs: SqlResultSet, withHeaders: boolean): string {
	const lines: string[] = [];
	if (withHeaders) lines.push(rs.columns.map((c) => cellText(c.name)).join('\t'));
	for (const row of rs.rows) lines.push(row.map(cellText).join('\t'));
	return lines.join('\r\n');
}

export async function copyTsv(rs: SqlResultSet, withHeaders: boolean): Promise<void> {
	await navigator.clipboard.writeText(toTsv(rs, withHeaders));
}

export interface CellRange {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export function rangeTsv(rs: SqlResultSet, range: CellRange, withHeaders: boolean): string {
	const lines: string[] = [];
	if (withHeaders) {
		lines.push(
			rs.columns
				.slice(range.left, range.right + 1)
				.map((column) => cellText(column.name))
				.join('\t')
		);
	}
	for (let rowIndex = range.top; rowIndex <= range.bottom; rowIndex++) {
		const row = rs.rows[rowIndex];
		if (!row) continue;
		lines.push(row.slice(range.left, range.right + 1).map(cellText).join('\t'));
	}
	return lines.join('\r\n');
}

export async function copyRangeTsv(
	rs: SqlResultSet,
	range: CellRange,
	withHeaders: boolean
): Promise<void> {
	await navigator.clipboard.writeText(rangeTsv(rs, range, withHeaders));
}

export function stackedTsv(resultSets: SqlResultSet[], withHeaders: boolean): string {
	return resultSets.map((resultSet) => toTsv(resultSet, withHeaders)).join('\r\n\r\n');
}

export async function copyStackedTsv(
	resultSets: SqlResultSet[],
	withHeaders: boolean
): Promise<void> {
	await navigator.clipboard.writeText(stackedTsv(resultSets, withHeaders));
}

/** Download all result sets as one .xlsx, one worksheet per result set. */
export async function exportXlsx(resultSets: SqlResultSet[], baseName: string): Promise<void> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();

	resultSets.forEach((rs, i) => {
		const ws = wb.addWorksheet(resultSets.length > 1 ? `Results ${i + 1}` : 'Results');
		ws.addRow(rs.columns.map((c, ci) => c.name || `(col ${ci + 1})`));
		ws.getRow(1).font = { bold: true };
		for (const row of rs.rows) {
			ws.addRow(
				row.map((v) => {
					if (v == null) return null;
					// ISO datetime strings become real Excel dates
					if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
						const d = new Date(v);
						if (!isNaN(d.getTime())) return d;
					}
					return v as CellValue;
				})
			);
		}
		ws.views = [{ state: 'frozen', ySplit: 1 }];
		// Reasonable column widths from header + sampled data
		rs.columns.forEach((c, ci) => {
			let w = (c.name ?? '').length;
			for (let r = 0; r < Math.min(rs.rows.length, 100); r++) {
				const v = rs.rows[r][ci];
				if (v != null) w = Math.max(w, String(v).length);
			}
			ws.getColumn(ci + 1).width = Math.min(Math.max(w + 2, 8), 60);
		});
	});

	const buf = await wb.xlsx.writeBuffer();
	const blob = new Blob([buf], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `${baseName.replace(/[\\/:*?"<>|]/g, '_') || 'results'}.xlsx`;
	a.click();
	URL.revokeObjectURL(a.href);
}
