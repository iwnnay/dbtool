<script lang="ts">
	import type { SqlResultSet } from './api';

	let { rs }: { rs: SqlResultSet } = $props();

	const ROW_H = 25;
	const RN_W = 52; // row-number gutter width

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

	let selected: { r: number; c: number } | null = $state(null);

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

<div class="grid-viewport" bind:this={viewport} onscroll={onScroll}>
	<div class="grid-inner" style="width:{totalW}px; height:{rs.rows.length * ROW_H + ROW_H}px;">
		<div class="grid-header" style="width:{totalW}px;">
			<div class="cell rn head" style="width:{RN_W}px;"></div>
			{#each rs.columns as col, ci (ci)}
				<div class="cell head" style="width:{widths[ci]}px;" title={col.type}>
					{col.name || '(no name)'}
				</div>
			{/each}
		</div>
		{#each visible as row, vi (first + vi)}
			{@const r = first + vi}
			<div class="grid-row" class:odd={r % 2 === 1} style="top:{r * ROW_H + ROW_H}px;">
				<div class="cell rn" style="width:{RN_W}px;">{r + 1}</div>
				{#each rs.columns as _, ci (ci)}
					{@const v = row[ci]}
					<div
						class="cell"
						class:null={v == null}
						class:num={typeof v === 'number'}
						class:sel={selected?.r === r && selected?.c === ci}
						style="width:{widths[ci]}px;"
						role="gridcell"
						tabindex="-1"
						onclick={() => (selected = { r, c: ci })}
						onkeydown={(e) => e.key === 'Enter' && (selected = { r, c: ci })}
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

<style>
	.grid-viewport {
		flex: 1;
		overflow: auto;
		background: var(--bg);
		font-family: var(--mono);
		font-size: 12px;
		position: relative;
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
	.cell.null {
		color: var(--null-text);
		font-style: italic;
	}
	.cell.num {
		text-align: right;
	}
	.cell.sel {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
		background: var(--sel-bg) !important;
	}
</style>
