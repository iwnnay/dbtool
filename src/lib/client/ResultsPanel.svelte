<script lang="ts">
	import { app } from './app.svelte';
	import type { Sheet, SqlResultSet } from './api';
	import Grid from './Grid.svelte';
	import MessagesPanel from './MessagesPanel.svelte';
	import { copyTsv, exportXlsx } from './export';

	let { sheet, onAppendSql }: { sheet: Sheet; onAppendSql: (sql: string) => void } = $props();

	const showingMessages = $derived(app.resultsView === 'messages');

	const run = $derived(app.runs[sheet.id] ?? null);
	const result = $derived(run?.result ?? null);
	const active = $derived(run?.activeResult ?? -1);
	const activeRs = $derived(result && active >= 0 ? (result.resultSets[active] ?? null) : null);
	const resultSets = $derived(result?.resultSets ?? []);
	const stacked = $derived(app.stackedResults);
	const totalRows = $derived(
		resultSets.reduce((total, resultSet) => total + resultSet.rowCount, 0)
	);

	// live elapsed while running
	let now = $state(Date.now());
	$effect(() => {
		if (!run?.running) return;
		const t = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(t);
	});

	let copied = $state('');
	async function copy(resultSet: SqlResultSet | null, withHeaders: boolean, copyToken: string) {
		if (!resultSet) return;
		await copyTsv(resultSet, withHeaders);
		copied = copyToken;
		setTimeout(() => (copied = ''), 1200);
	}

	function selectTab(index: number) {
		app.resultsView = 'results';
		if (run) app.runs[sheet.id] = { ...run, activeResult: index };
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
			{#if result}
				{#if stacked && resultSets.length}
					<button
						class="tab"
						class:active={!showingMessages && active !== -1}
						onclick={() => selectTab(0)}
					>
						All results {resultSets.length > 1 ? `(${resultSets.length})` : ''}
						<span class="count">{totalRows.toLocaleString()}</span>
					</button>
				{:else}
					{#each resultSets as resultSet, index (index)}
						<button
							class="tab"
							class:active={!showingMessages && active === index}
							onclick={() => selectTab(index)}
						>
							Results {resultSets.length > 1 ? index + 1 : ''}
							<span class="count">
								{resultSet.rowCount.toLocaleString()}{resultSet.truncated ? '+' : ''}
							</span>
						</button>
					{/each}
				{/if}
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
			{#if !showingMessages && result}
			{#if resultSets.length > 1}
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
			{/if}
			{#if resultSets.length}
				<button
					class="btn"
					onclick={() => exportXlsx(resultSets, `${sheet.name}-${sheet.database}`)}
					title="Download all result sets as .xlsx"
				>
					Export Excel
				</button>
			{/if}
			{/if}
		</div>

		{#if showingMessages}
			<MessagesPanel {onAppendSql} />
		{:else if !result}
			<div class="center-note hint">
				<span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> run statement at cursor · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> run all</span>
			</div>
		{:else if stacked && resultSets.length}
			<div class="stacked">
				{#each resultSets as resultSet, index (index)}
					<section class="stacked-set">
						<header class="stacked-head">
							<span class="stacked-title">
								Results {resultSets.length > 1 ? index + 1 : ''}
							</span>
							<span class="count">
								{resultSet.rowCount.toLocaleString()}{resultSet.truncated ? '+' : ''}
							</span>
							{#if resultSet.truncated}
								<span class="warn-inline">
									showing first {resultSet.rows.length.toLocaleString()}
								</span>
							{/if}
							<span class="spacer"></span>
							<button
								class="btn"
								onclick={() => copy(resultSet, false, `${index}:plain`)}
								title="Copy this result set as TSV"
							>
								{copied === `${index}:plain` ? '✓ Copied' : 'Copy'}
							</button>
							<button
								class="btn"
								onclick={() => copy(resultSet, true, `${index}:headers`)}
								title="Copy this result set as TSV with headers"
							>
								{copied === `${index}:headers` ? '✓ Copied' : '+ Headers'}
							</button>
						</header>
						<div class="stacked-grid">
							<Grid rs={resultSet} />
						</div>
					</section>
				{/each}
			</div>
		{:else if activeRs}
			{#if activeRs.truncated}
				<div class="truncated-note">
					Showing first {activeRs.rows.length.toLocaleString()} of {activeRs.rowCount.toLocaleString()} rows
					(display cap — refine the query or export needs a TOP/WHERE)
				</div>
			{/if}
			<Grid rs={activeRs} />
		{/if}
	{/if}
</div>

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
		height: 320px;
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
