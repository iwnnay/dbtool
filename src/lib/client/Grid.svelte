<script module lang="ts">
	export const GRID_ROW_HEIGHT = 25;
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import type { SqlResultSet } from './api';
	import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
	import { copyRangeTsv, type CellRange } from './export';
	import { findCells, nextSort, sortRows, type SortSpec } from './resultGrid';

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
	let sorts: SortSpec[] = $state([]);
	let findOpen = $state(false);
	let findQuery = $state('');
	let currentMatch = $state(0);
	let findInput: HTMLInputElement | undefined = $state();

	const displayedRows = $derived(sortRows(rs.rows, sorts));
	const displayedResult = $derived({ ...rs, rows: displayedRows.map((entry) => entry.row) });
	const matches = $derived(findCells(displayedRows, findQuery));
	const matchKeys = $derived(new Set(matches.map((match) => `${match.row}:${match.col}`)));
	const activeMatch = $derived(matches[currentMatch] ?? null);

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
	const last = $derived(Math.min(displayedRows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 8));
	const visible = $derived(displayedRows.slice(first, last));

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

	const lastRow = $derived(Math.max(displayedRows.length - 1, 0));
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
		sorts = [];
		findQuery = '';
		findOpen = false;
	});

	$effect(() => {
		void matches;
		currentMatch = 0;
		if (findQuery && matches.length) void tick().then(() => scrollToMatch(0));
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
		await copyRangeTsv(displayedResult, range, withHeaders);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!event.ctrlKey && !event.metaKey) return;
		const key = event.key.toLowerCase();
		if (key === 'f') {
			event.preventDefault();
			findOpen = true;
			void tick().then(() => {
				findInput?.focus();
				findInput?.select();
			});
		} else if (key === 'a') {
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
				const originalIndex = displayedRows[selected]?.originalIndex;
				if (originalIndex != null && !deletedRows?.has(originalIndex)) rowIndexes.push(originalIndex);
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
		const v = displayedRows[r]?.row[c];
		await navigator.clipboard.writeText(v == null ? 'NULL' : String(v));
	}

	function toggleSort(column: number, additive: boolean) {
		sorts = nextSort(sorts, column, additive);
		anchor = null;
		head = null;
		if (viewport) viewport.scrollTop = 0;
	}

	function sortFor(column: number): { direction: 'asc' | 'desc'; priority: number } | null {
		const priority = sorts.findIndex((sort) => sort.column === column);
		return priority < 0 ? null : { direction: sorts[priority].direction, priority: priority + 1 };
	}

	function scrollToMatch(index: number) {
		if (!matches.length || !viewport) return;
		currentMatch = (index + matches.length) % matches.length;
		const match = matches[currentMatch];
		viewport.scrollTop = Math.max(0, match.row * ROW_H - Math.max(ROW_H, (viewH - ROW_H) / 2));
		let left = RN_W;
		for (let column = 0; column < match.col; column++) left += widths[column];
		const right = left + widths[match.col];
		if (left < viewport.scrollLeft + RN_W) viewport.scrollLeft = Math.max(0, left - RN_W);
		else if (right > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = right - viewport.clientWidth;
	}

	function onFindKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			findInput?.select();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			scrollToMatch(currentMatch + (event.shiftKey ? -1 : 1));
		} else if (event.key === 'Escape') {
			event.preventDefault();
			findOpen = false;
			findQuery = '';
			viewport?.focus();
		}
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
	{#if findOpen}
		<div class="findbar" role="search">
			<input bind:this={findInput} bind:value={findQuery} onkeydown={onFindKeydown} placeholder="Search all results" aria-label="Search all result cells" />
			<span class="find-count">{matches.length ? `${currentMatch + 1} / ${matches.length}` : '0 / 0'}</span>
			<button title="Previous match (Shift+Enter)" onclick={() => scrollToMatch(currentMatch - 1)} disabled={!matches.length}>↑</button>
			<button title="Next match (Enter)" onclick={() => scrollToMatch(currentMatch + 1)} disabled={!matches.length}>↓</button>
			<button title="Close search (Escape)" onclick={() => { findOpen = false; findQuery = ''; viewport?.focus(); }}>×</button>
		</div>
	{/if}
	<div class="grid-inner" style="width:{totalW}px; height:{displayedRows.length * ROW_H + ROW_H}px;">
		<div class="grid-header" style="width:{totalW}px;" role="row">
			<div class="cell rn head" style="width:{RN_W}px;"></div>
			{#each rs.columns as col, ci (ci)}
				{@const sort = sortFor(ci)}
				<div
					class="cell head"
					class:sorted={!!sort}
					class:headsel={!!range && ci >= range.left && ci <= range.right}
					style="width:{widths[ci]}px;"
					title={`${col.type} · Click to sort; Shift+click for multi-column sort`}
					role="columnheader"
					tabindex="0"
					onclick={(event) => toggleSort(ci, event.shiftKey)}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							toggleSort(ci, event.shiftKey);
						}
					}}
				>
					<span class="head-label">{col.name || '(no name)'}</span>
					{#if sort}<span class="sort-mark">{sort.direction === 'asc' ? '▲' : '▼'}{sorts.length > 1 ? sort.priority : ''}</span>{/if}
				</div>
			{/each}
		</div>
		{#each visible as rowEntry, vi (rowEntry.originalIndex)}
			{@const r = first + vi}
			{@const row = rowEntry.row}
			{@const originalRow = rowEntry.originalIndex}
			<div
				class="grid-row"
				class:odd={r % 2 === 1}
				class:deleted={deletedRows?.has(originalRow)}
				style="top:{r * ROW_H + ROW_H}px;"
				role="row"
				title={deletedRows?.has(originalRow) ? 'Row deleted from the table' : undefined}
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
						class:match={matchKeys.has(`${r}:${ci}`)}
						class:current-match={activeMatch?.row === r && activeMatch?.col === ci}
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
	.findbar {
		position: absolute;
		top: 4px;
		right: 12px;
		z-index: 8;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px;
		background: var(--panel);
		border: 1px solid var(--border-strong);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
		font-family: var(--sans);
	}
	.findbar input {
		width: 220px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		font-size: 12px;
		padding: 4px 7px;
		outline: none;
	}
	.findbar input:focus { border-color: var(--accent); }
	.findbar button {
		background: transparent;
		border: none;
		border-radius: 3px;
		color: var(--text);
		cursor: pointer;
		padding: 2px 6px;
	}
	.findbar button:hover:not(:disabled) { background: var(--panel2); }
	.findbar button:disabled { opacity: 0.35; cursor: default; }
	.find-count { min-width: 56px; color: var(--muted); font-size: 11px; text-align: center; }
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
	.cell.head.sorted { color: var(--accent); }
	.head-label { overflow: hidden; text-overflow: ellipsis; }
	.sort-mark { margin-left: 6px; font-size: 9px; color: var(--accent); }
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
	.cell.match {
		background: rgba(232, 180, 94, 0.2) !important;
		box-shadow: inset 0 0 0 1px rgba(232, 180, 94, 0.55);
	}
	.cell.current-match {
		background: rgba(232, 180, 94, 0.38) !important;
		outline: 2px solid var(--warn);
		outline-offset: -2px;
	}
</style>
