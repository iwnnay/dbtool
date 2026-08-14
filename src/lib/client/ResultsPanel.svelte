<script lang="ts">
	import { app, type ResultTab } from './app.svelte';
	import type { Sheet, SqlResultSet } from './api';
	import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
	import DeleteRowsModal from './DeleteRowsModal.svelte';
	import Grid, { GRID_ROW_HEIGHT } from './Grid.svelte';
	import MessagesPanel from './MessagesPanel.svelte';
	import { copyTsv, copyStackedTsv, exportXlsx } from './export';

	let { sheet, onAppendSql }: { sheet: Sheet; onAppendSql: (sql: string) => void } = $props();

	const showingMessages = $derived(app.resultsView === 'messages');
	const run = $derived(app.runs[sheet.id] ?? null);
	const result = $derived(run?.result ?? null);
	const stacked = $derived(app.stackedResults);
	const tabs = $derived(app.resultTabs[sheet.id] ?? []);
	const activeTab = $derived(
		tabs.find((tab) => tab.id === app.activeTabId[sheet.id]) ?? tabs[0] ?? null
	);
	const activeRs = $derived(activeTab?.resultSet ?? null);
	const totalRows = $derived(tabs.reduce((total, tab) => total + tab.resultSet.rowCount, 0));
	const canStack = $derived(tabs.length > 1);

	// live elapsed while running
	let now = $state(Date.now());
	$effect(() => {
		if (!run?.running) return;
		const t = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(t);
	});

	let stackedViewHeight = $state(0);
	let stackedHeadHeight = $state(28);
	const STACKED_PADDING = 16;
	const STACKED_SET_BORDER = 2;
	const maxStackedGridHeight = $derived(
		Math.max(
			stackedViewHeight - STACKED_PADDING - stackedHeadHeight - STACKED_SET_BORDER,
			GRID_ROW_HEIGHT * 3
		)
	);
	function stackedGridHeight(resultSet: SqlResultSet): number {
		const contentHeight = (resultSet.rows.length + 1) * GRID_ROW_HEIGHT;
		return Math.min(contentHeight, maxStackedGridHeight);
	}

	let copied = $state('');
	async function copy(resultSet: SqlResultSet | null, withHeaders: boolean, copyToken: string) {
		if (!resultSet) return;
		await copyTsv(resultSet, withHeaders);
		copied = copyToken;
		setTimeout(() => (copied = ''), 1200);
	}

	async function copyAllStacked(withHeaders: boolean, copyToken: string) {
		if (!tabs.length) return;
		await copyStackedTsv(
			tabs.map((tab) => tab.resultSet),
			withHeaders
		);
		copied = copyToken;
		setTimeout(() => (copied = ''), 1200);
	}

	function selectTab(tabId: number) {
		app.resultsView = 'results';
		app.activeTabId[sheet.id] = tabId;
	}

	let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
	let deleting = $state<{ tab: ResultTab; rowIndexes: number[] } | null>(null);
	let renamingTabId = $state<number | null>(null);
	let renameValue = $state('');

	function startRename(tab: ResultTab) {
		renameValue = tab.label;
		renamingTabId = tab.id;
	}

	function commitRename() {
		if (renamingTabId !== null) app.renameTab(sheet.id, renamingTabId, renameValue);
		renamingTabId = null;
	}

	function openTabMenu(event: MouseEvent, tab: ResultTab) {
		event.preventDefault();
		menu = {
			x: event.clientX,
			y: event.clientY,
			items: [
				{ label: 'Rename…', action: () => startRename(tab) },
				{ label: tab.pinned ? 'Unpin' : 'Pin', action: () => app.togglePin(sheet.id, tab.id) }
			]
		};
	}

	function fmtMs(ms: number): string {
		if (ms < 1000) return `${ms} ms`;
		const s = ms / 1000;
		if (s < 60) return `${s.toFixed(1)} s`;
		return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	}
</script>

<div class="results">
	{#if run?.running}
		<div class="center-note">
			<div class="spinner"></div>
			<span>Executing… {fmtMs(now - run.startedAt)}</span>
			<button class="btn danger" onclick={() => app.cancel(sheet.id)}>Cancel</button>
		</div>
	{:else}
		<div class="tabbar">
			{#if stacked && tabs.length}
				<button class="tab" class:active={!showingMessages} onclick={() => selectTab(tabs[0].id)}>
					All results {tabs.length > 1 ? `(${tabs.length})` : ''}
					<span class="count">{totalRows.toLocaleString()}</span>
				</button>
			{:else}
				{#each tabs as tab (tab.id)}
					{#if renamingTabId === tab.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="tab-rename"
							bind:value={renameValue}
							autofocus
							onblur={commitRename}
							onkeydown={(event) => {
								if (event.key === 'Enter') commitRename();
								if (event.key === 'Escape') renamingTabId = null;
							}}
						/>
					{:else}
					<button
						class="tab"
						class:active={!showingMessages && activeTab?.id === tab.id}
						onclick={() => selectTab(tab.id)}
						oncontextmenu={(event) => openTabMenu(event, tab)}
						ondblclick={() => startRename(tab)}
						title="{tab.title} — right-click to rename"
					>
						<span
							class="pin"
							class:on={tab.pinned}
							role="button"
							tabindex="0"
							title={tab.pinned ? 'Unpin' : 'Pin'}
							onclick={(event) => {
								event.stopPropagation();
								app.togglePin(sheet.id, tab.id);
							}}
							onkeydown={(event) => {
								if (event.key === 'Enter') app.togglePin(sheet.id, tab.id);
							}}
						>📌</span>
						{tab.label}
						<span class="count">
							{tab.resultSet.rowCount.toLocaleString()}{tab.resultSet.truncated ? '+' : ''}
						</span>
					</button>
					{/if}
				{/each}
			{/if}
			<button
				class="tab"
				class:active={showingMessages}
				class:err={result ? !result.ok : false}
				onclick={() => (app.resultsView = 'messages')}
				title="Every query that has been run, with its messages"
			>
				Messages
				{#if result && (result.messages.length || result.error)}<span class="count">{result.messages.length + (result.error ? 1 : 0)}</span>{/if}
			</button>
			<div class="spacer"></div>
			{#if !showingMessages && tabs.length}
			{#if canStack}
				<button
					class="btn"
					onclick={() => app.toggleStackedResults()}
					title={stacked
						? 'Show each result set in its own tab'
						: 'Stack every result set into one scrolling view'}
				>
					{stacked ? '▤ Tabs' : '▦ Stacked'}
				</button>
			{/if}
			{#if activeRs && !stacked}
				<button
					class="btn"
					onclick={() => copy(activeRs, false, 'plain')}
					title="Copy all rows as tab-separated values"
				>
					{copied === 'plain' ? '✓ Copied' : 'Copy TSV'}
				</button>
				<button
					class="btn"
					onclick={() => copy(activeRs, true, 'hdr')}
					title="Copy all rows as TSV with a header row"
				>
					{copied === 'hdr' ? '✓ Copied' : 'Copy + Headers'}
				</button>
			{:else if stacked}
				<button
					class="btn"
					onclick={() => copyAllStacked(false, 'all-plain')}
					title="Copy every result set as TSV, stacked one after another"
				>
					{copied === 'all-plain' ? '✓ Copied' : 'Copy TSV'}
				</button>
				<button
					class="btn"
					onclick={() => copyAllStacked(true, 'all-hdr')}
					title="Copy every result set as TSV, stacked one after another, each with a header row"
				>
					{copied === 'all-hdr' ? '✓ Copied' : 'Copy + Headers'}
				</button>
			{/if}
			{#if tabs.length}
				<button
					class="btn"
					onclick={() => exportXlsx(
						tabs.map((tab) => tab.resultSet),
						`${sheet.name}-${sheet.database}`
					)}
					title="Download every open result set as .xlsx"
				>
					Export Excel
				</button>
			{/if}
			{/if}
		</div>

		{#if showingMessages}
			<MessagesPanel {onAppendSql} />
		{:else if stacked && tabs.length}
			<div class="stacked" bind:clientHeight={stackedViewHeight}>
				{#each tabs as tab (tab.id)}
					<section class="stacked-set">
						<header class="stacked-head" bind:clientHeight={stackedHeadHeight}>
							<span
								class="pin"
								class:on={tab.pinned}
								role="button"
								tabindex="0"
								title={tab.pinned ? 'Unpin' : 'Pin'}
								onclick={() => app.togglePin(sheet.id, tab.id)}
								onkeydown={(event) => {
									if (event.key === 'Enter') app.togglePin(sheet.id, tab.id);
								}}
							>📌</span>
							<span
							class="stacked-title"
							role="button"
							tabindex="0"
							title="Right-click to rename"
							oncontextmenu={(event) => openTabMenu(event, tab)}
							ondblclick={() => startRename(tab)}
						>{tab.label}</span>
							<span class="count">
								{tab.resultSet.rowCount.toLocaleString()}{tab.resultSet.truncated ? '+' : ''}
							</span>
							{#if tab.resultSet.truncated}
								<span class="warn-inline">
									showing first {tab.resultSet.rows.length.toLocaleString()}
								</span>
							{/if}
							<span class="spacer"></span>
							<button
								class="btn"
								onclick={() => copy(tab.resultSet, false, `${tab.id}:plain`)}
								title="Copy this result set as TSV"
							>
								{copied === `${tab.id}:plain` ? '✓ Copied' : 'Copy'}
							</button>
							<button
								class="btn"
								onclick={() => copy(tab.resultSet, true, `${tab.id}:headers`)}
								title="Copy this result set as TSV with headers"
							>
								{copied === `${tab.id}:headers` ? '✓ Copied' : '+ Headers'}
							</button>
						</header>
						<div class="stacked-grid" style="height:{stackedGridHeight(tab.resultSet)}px;">
							<Grid
								rs={tab.resultSet}
								deletedRows={tab.deletedRows}
								onDeleteRows={(rowIndexes) => (deleting = { tab, rowIndexes })}
							/>
						</div>
					</section>
				{/each}
			</div>
		{:else if !result}
			<div class="center-note hint">
				<span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> run statement at cursor · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> run all</span>
			</div>
		{:else if activeRs}
			{#if activeRs.truncated}
				<div class="truncated-note">
					Showing first {activeRs.rows.length.toLocaleString()} of {activeRs.rowCount.toLocaleString()} rows
					(display cap — refine the query or export needs a TOP/WHERE)
				</div>
			{/if}
			<Grid
				rs={activeRs}
				deletedRows={activeTab?.deletedRows}
				onDeleteRows={(rowIndexes) => {
					if (activeTab) deleting = { tab: activeTab, rowIndexes };
				}}
			/>
		{/if}
	{/if}
</div>

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

{#if deleting}
	<DeleteRowsModal
		{sheet}
		tab={deleting.tab}
		rowIndexes={deleting.rowIndexes}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.results {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--bg);
	}
	.center-note {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--muted);
		font-size: 13px;
	}
	.center-note kbd {
		background: var(--panel2);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 1px 5px;
		font-family: var(--mono);
		font-size: 11px;
	}
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.tabbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px 8px 0;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		flex: none;
	}
	.tab {
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--muted);
		padding: 5px 10px;
		font-size: 12px;
		cursor: pointer;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.tab.err {
		color: var(--error);
	}
	.pin {
		font-size: 10px;
		line-height: 1;
		opacity: 0;
		filter: grayscale(1);
		transition: opacity 0.1s;
		cursor: pointer;
	}
	.tab:hover .pin,
	.stacked-head:hover .pin {
		opacity: 0.55;
	}
	.pin:hover {
		opacity: 1 !important;
		filter: none;
	}
	.pin.on {
		opacity: 1;
		filter: none;
	}
	.tab-rename {
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: 4px;
		color: var(--text);
		font-size: 12px;
		padding: 3px 6px;
		margin: 2px;
		width: 130px;
		outline: none;
	}
	.stacked-title {
		cursor: default;
	}
	.tab .count {
		background: var(--panel2);
		border-radius: 8px;
		padding: 0 6px;
		margin-left: 4px;
		font-size: 10px;
		color: var(--muted);
	}
	.spacer {
		flex: 1;
	}
	.btn {
		background: var(--panel2);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		font-size: 11.5px;
		padding: 3px 10px;
		margin: 0 2px 4px;
		cursor: pointer;
	}
	.btn:hover {
		border-color: var(--accent);
	}
	.btn.danger {
		border-color: var(--error);
		color: var(--error);
	}
	.stacked {
		flex: 1;
		overflow: auto;
		min-height: 0;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.stacked-set {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		flex: none;
	}
	.stacked-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		font-size: 11.5px;
		flex: none;
	}
	.stacked-title {
		color: var(--text);
		font-weight: 600;
	}
	.warn-inline {
		color: var(--warn);
		font-size: 11px;
	}
	.stacked-grid {
		display: flex;
		flex-direction: column;
		flex: none;
		min-height: 0;
	}
	.truncated-note {
		flex: none;
		padding: 4px 12px;
		font-size: 11.5px;
		color: var(--warn);
		background: var(--panel);
		border-bottom: 1px solid var(--border);
	}
</style>
