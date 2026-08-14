<script module lang="ts">
	export const GRID_ROW_HEIGHT = 25;
</script>

<script lang="ts">
	import type { SqlResultSet } from './api';
	import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
	import { copyRangeTsv, type CellRange } from './export';

	let {
		rs,
		deletedRows,
		onDeleteRows
	}: {
		rs: SqlResultSet;
		deletedRows?: Set<number>;
		onDeleteRows?: (rowIndexes: number[]) => void;
	} = $props();

	const ROW_H = GRID_ROW_HEIGHT;
	const RN_W = 52; // row-number gutter width
	const EDGE = 24;
	const SCROLL_STEP = 16;

	let viewport: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let viewH = $state(300);

	// Column widths estimated from header + a sample of rows (monospace ~7.3px/ch)
	const widths = $derived.by(() => {
		return rs.columns.map((c, ci) => {
			let chars = (c.name || '(no name)').length;
			const sample = Math.min(rs.rows.length, 80);
			for (let r = 0; r < sample; r++) {
				const v = rs.rows[r][ci];
				if (v != null) chars = Math.max(chars, String(v).length);
			}
			return Math.min(Math.max(chars * 7.3 + 18, 70), 420);
		});
	});
	const totalW = $derived(widths.reduce((a, b) => a + b, 0) + RN_W);

	const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - 8));
	const last = $derived(Math.min(rs.rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 8));
	const visible = $derived(rs.rows.slice(first, last));

	interface CellRef {
		row: number;
		col: number;
	}

	let anchor: CellRef | null = $state(null);
	let head: CellRef | null = $state(null);
	let dragMode: 'cell' | 'row' | 'col' | null = $state(null);
	let scrollStep = $state(0);
	let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
	let pointerX = 0;
	let pointerY = 0;

	const lastRow = $derived(Math.max(rs.rows.length - 1, 0));
	const lastCol = $derived(Math.max(rs.columns.length - 1, 0));

	const range: CellRange | null = $derived.by(() => {
		const start = anchor;
		const end = head;
		if (!start || !end) return null;
		return {
			top: Math.min(start.row, end.row),
			bottom: Math.max(start.row, end.row),
			left: Math.min(start.col, end.col),
			right: Math.max(start.col, end.col)
		};
	});

	$effect(() => {
		void rs;
		anchor = null;
		head = null;
	});

	function inRange(rowIndex: number, colIndex: number): boolean {
		if (!range) return false;
		return (
			rowIndex >= range.top &&
			rowIndex <= range.bottom &&
			colIndex >= range.left &&
			colIndex <= range.right
		);
	}

	function clamp(value: number, low: number, high: number): number {
		return Math.min(Math.max(value, low), high);
	}

	function selectCell(rowIndex: number, colIndex: number, extend: boolean) {
		if (extend && anchor) head = { row: rowIndex, col: colIndex };
		else {
			anchor = { row: rowIndex, col: colIndex };
			head = { row: rowIndex, col: colIndex };
		}
	}

	function selectRows(rowIndex: number, extend: boolean) {
		anchor = { row: extend && anchor ? anchor.row : rowIndex, col: 0 };
		head = { row: rowIndex, col: lastCol };
	}

	function selectColumns(colIndex: number, extend: boolean) {
		anchor = { row: 0, col: extend && anchor ? anchor.col : colIndex };
		head = { row: lastRow, col: colIndex };
	}

	function selectAll() {
		anchor = { row: 0, col: 0 };
		head = { row: lastRow, col: lastCol };
	}

	function rowAtPoint(clientY: number): number {
		if (!viewport) return 0;
		const bounds = viewport.getBoundingClientRect();
		const offset = clientY - bounds.top + viewport.scrollTop - ROW_H;
		return clamp(Math.floor(offset / ROW_H), 0, lastRow);
	}

	function colAtPoint(clientX: number): number {
		if (!viewport) return 0;
		const bounds = viewport.getBoundingClientRect();
		let offset = clientX - bounds.left + viewport.scrollLeft - RN_W;
		for (let colIndex = 0; colIndex < widths.length; colIndex++) {
			offset -= widths[colIndex];
			if (offset < 0) return colIndex;
		}
		return lastCol;
	}

	function startDrag(mode: 'cell' | 'row' | 'col', event: MouseEvent) {
		dragMode = mode;
		pointerX = event.clientX;
		pointerY = event.clientY;
		viewport?.focus({ preventScroll: true });
	}

	function extendToPointer() {
		if (dragMode === 'col') head = { row: lastRow, col: colAtPoint(pointerX) };
		else if (dragMode === 'row') head = { row: rowAtPoint(pointerY), col: lastCol };
		else if (dragMode === 'cell') head = { row: rowAtPoint(pointerY), col: colAtPoint(pointerX) };
	}

	function onWindowMouseMove(event: MouseEvent) {
		if (!dragMode || !viewport) return;
		pointerX = event.clientX;
		pointerY = event.clientY;
		extendToPointer();
		if (dragMode === 'col') return;
		const bounds = viewport.getBoundingClientRect();
		if (event.clientY > bounds.bottom - EDGE) scrollStep = SCROLL_STEP;
		else if (event.clientY < bounds.top + ROW_H + EDGE) scrollStep = -SCROLL_STEP;
		else scrollStep = 0;
	}

	function endDrag() {
		dragMode = null;
		scrollStep = 0;
	}

	$effect(() => {
		if (!scrollStep) return;
		const timer = setInterval(() => {
			if (!viewport) return;
			viewport.scrollTop += scrollStep;
			extendToPointer();
		}, 30);
		return () => clearInterval(timer);
	});

	async function copySelection(withHeaders: boolean) {
		if (!range) return;
		await copyRangeTsv(rs, range, withHeaders);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!event.ctrlKey && !event.metaKey) return;
		const key = event.key.toLowerCase();
		if (key === 'a') {
			event.preventDefault();
			selectAll();
		} else if (key === 'c' && range) {
			event.preventDefault();
			void copySelection(false);
		}
	}

	function onContextMenu(event: MouseEvent) {
		event.preventDefault();
		if (!viewport) return;
		const bounds = viewport.getBoundingClientRect();
		const colIndex = colAtPoint(event.clientX);
		const rowIndex = rowAtPoint(event.clientY);
		const onRowNumber = event.clientY - bounds.top >= ROW_H && event.clientX - bounds.left < RN_W;

		if (event.clientY - bounds.top < ROW_H) {
			if (!range || colIndex < range.left || colIndex > range.right) selectColumns(colIndex, false);
		} else if (onRowNumber) {
			if (!inRange(rowIndex, 0)) selectRows(rowIndex, false);
		} else if (!inRange(rowIndex, colIndex)) {
			selectCell(rowIndex, colIndex, false);
		}

		const items: MenuItem[] = [
			{ label: 'Copy', action: () => void copySelection(false) },
			{ label: 'Copy with headers', action: () => void copySelection(true) }
		];
		if (onRowNumber && onDeleteRows && range) {
			const rowIndexes: number[] = [];
			for (let selected = range.top; selected <= range.bottom; selected++) {
				if (!deletedRows?.has(selected)) rowIndexes.push(selected);
			}
			if (rowIndexes.length > 0) {
				items.push({
					label: rowIndexes.length > 1 ? `Delete ${rowIndexes.length} rows…` : 'Delete row…',
					action: () => onDeleteRows(rowIndexes)
				});
			}
		}

		menu = { x: event.clientX, y: event.clientY, items };
	}

	function fmt(v: unknown): string {
		if (v == null) return 'NULL';
		if (typeof v === 'boolean') return v ? '1' : '0';
		if (typeof v === 'string') {
			// ISO datetimes read better with a space; drop pure-midnight time part
			if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
				return v.replace('T', ' ').replace(/\.?0+$/, '').replace(/ 00:00:00$/, '');
			}
			return v;
		}
		return String(v);
	}

	function onScroll() {
		if (!viewport) return;
		scrollTop = viewport.scrollTop;
	}

	$effect(() => {
		if (!viewport) return;
		const ro = new ResizeObserver(() => {
			viewH = viewport!.clientHeight;
		});
		ro.observe(viewport);
		return () => ro.disconnect();
	});

	async function copyCell(r: number, c: number) {
		const v = rs.rows[r]?.[c];
		await navigator.clipboard.writeText(v == null ? 'NULL' : String(v));
	}
</script>

<svelte:window onmousemove={onWindowMouseMove} onmouseup={endDrag} />

<div
	class="grid-viewport"
	bind:this={viewport}
	role="grid"
	tabindex="0"
	onscroll={onScroll}
	onkeydown={onKeydown}
	oncontextmenu={onContextMenu}
>
	<div class="grid-inner" style="width:{totalW}px; height:{rs.rows.length * ROW_H + ROW_H}px;">
		<div class="grid-header" style="width:{totalW}px;" role="row">
			<div class="cell rn head" style="width:{RN_W}px;"></div>
			{#each rs.columns as col, ci (ci)}
				<div
					class="cell head"
					class:headsel={!!range && ci >= range.left && ci <= range.right}
					style="width:{widths[ci]}px;"
					title={col.type}
					role="columnheader"
					tabindex="-1"
					onmousedown={(event) => {
						if (event.button !== 0) return;
						selectColumns(ci, event.shiftKey);
						startDrag('col', event);
					}}
				>
					{col.name || '(no name)'}
				</div>
			{/each}
		</div>
		{#each visible as row, vi (first + vi)}
			{@const r = first + vi}
			<div
				class="grid-row"
				class:odd={r % 2 === 1}
				class:deleted={deletedRows?.has(r)}
				style="top:{r * ROW_H + ROW_H}px;"
				role="row"
				title={deletedRows?.has(r) ? 'Row deleted from the table' : undefined}
			>
				<div
					class="cell rn"
					class:headsel={!!range && r >= range.top && r <= range.bottom}
					style="width:{RN_W}px;"
					role="rowheader"
					tabindex="-1"
					onmousedown={(event) => {
						if (event.button !== 0) return;
						selectRows(r, event.shiftKey);
						startDrag('row', event);
					}}
				>{r + 1}</div>
				{#each rs.columns as _, ci (ci)}
					{@const v = row[ci]}
					<div
						class="cell"
						class:null={v == null}
						class:num={typeof v === 'number'}
						class:sel={inRange(r, ci)}
						class:anchored={anchor?.row === r && anchor?.col === ci}
						style="width:{widths[ci]}px;"
						role="gridcell"
						tabindex="-1"
						onmousedown={(event) => {
							if (event.button !== 0) return;
							selectCell(r, ci, event.shiftKey);
							startDrag('cell', event);
						}}
						onkeydown={(e) => e.key === 'Enter' && selectCell(r, ci, false)}
						ondblclick={() => copyCell(r, ci)}
						title={v == null ? 'NULL' : String(v)}
					>
						{fmt(v)}
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

<style>
	.grid-viewport {
		flex: 1;
		min-height: 0;
		overflow: auto;
		background: var(--bg);
		font-family: var(--mono);
		font-size: 12px;
		position: relative;
		outline: none;
	}
	.grid-inner {
		position: relative;
	}
	.grid-header {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		height: 25px;
	}
	.grid-row {
		position: absolute;
		display: flex;
		height: 25px;
		left: 0;
	}
	.cell {
		flex: none;
		padding: 4px 8px 0;
		border-right: 1px solid var(--grid-line);
		border-bottom: 1px solid var(--grid-line);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
		background: var(--bg);
		cursor: default;
		user-select: none;
	}
	.grid-row.odd .cell {
		background: var(--bg-alt);
	}
	.grid-row.deleted .cell {
		color: var(--muted);
		text-decoration: line-through;
		opacity: 0.5;
	}
	.grid-row.deleted .cell.rn {
		color: var(--error);
		text-decoration: none;
		opacity: 1;
	}
	.cell.head {
		background: var(--panel2);
		color: var(--head-text);
		font-weight: 600;
		border-bottom: 1px solid var(--border-strong);
		position: sticky;
		top: 0;
	}
	.cell.rn {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--panel2);
		color: var(--muted);
		text-align: right;
	}
	.cell.rn.head {
		z-index: 3;
	}
	.cell.head,
	.cell.rn {
		cursor: pointer;
	}
	.cell.headsel {
		background: var(--sel-bg);
		color: var(--text);
	}
	.cell.null {
		color: var(--null-text);
		font-style: italic;
	}
	.cell.num {
		text-align: right;
	}
	.cell.sel {
		background: var(--sel-bg) !important;
	}
	.cell.anchored {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
</style>
