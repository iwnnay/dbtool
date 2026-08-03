<script lang="ts">
	import { app } from './app.svelte';
	import type { Sheet } from './api';
	import Grid from './Grid.svelte';
	import { copyTsv, exportXlsx } from './export';

	let { sheet }: { sheet: Sheet } = $props();

	const run = $derived(app.runs[sheet.id] ?? null);
	const result = $derived(run?.result ?? null);
	const active = $derived(run?.activeResult ?? -1);
	const activeRs = $derived(result && active >= 0 ? (result.resultSets[active] ?? null) : null);

	// live elapsed while running
	let now = $state(Date.now());
	$effect(() => {
		if (!run?.running) return;
		const t = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(t);
	});

	let copied = $state('');
	async function copy(withHeaders: boolean) {
		if (!activeRs) return;
		await copyTsv(activeRs, withHeaders);
		copied = withHeaders ? 'hdr' : 'plain';
		setTimeout(() => (copied = ''), 1200);
	}

	function selectTab(i: number) {
		if (run) app.runs[sheet.id] = { ...run, activeResult: i };
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
	{:else if !result}
		<div class="center-note hint">
			<span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> run statement at cursor · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> run all</span>
		</div>
	{:else}
		<div class="tabbar">
			{#each result.resultSets as rs, i (i)}
				<button class="tab" class:active={active === i} onclick={() => selectTab(i)}>
					Results {result.resultSets.length > 1 ? i + 1 : ''}
					<span class="count">{rs.rowCount.toLocaleString()}{rs.truncated ? '+' : ''}</span>
				</button>
			{/each}
			<button class="tab" class:active={active === -1} class:err={!result.ok} onclick={() => selectTab(-1)}>
				Messages
				{#if result.messages.length || result.error}<span class="count">{result.messages.length + (result.error ? 1 : 0)}</span>{/if}
			</button>
			<div class="spacer"></div>
			{#if activeRs}
				<button class="btn" onclick={() => copy(false)} title="Copy all rows as tab-separated values">
					{copied === 'plain' ? '✓ Copied' : 'Copy TSV'}
				</button>
				<button class="btn" onclick={() => copy(true)} title="Copy all rows as TSV with a header row">
					{copied === 'hdr' ? '✓ Copied' : 'Copy + Headers'}
				</button>
				<button
					class="btn"
					onclick={() => exportXlsx(result.resultSets, `${sheet.name}-${sheet.database}`)}
					title="Download all result sets as .xlsx"
				>
					Export Excel
				</button>
			{/if}
		</div>

		{#if active === -1}
			<div class="messages">
				{#if result.error}
					<div class="msg error">
						✕ {result.error.text}{result.error.line != null ? ` (line ${result.error.line})` : ''}
					</div>
				{/if}
				{#each result.messages as m, i (i)}
					<div class="msg" class:warn={(m.severity ?? 0) > 10}>{m.text}</div>
				{/each}
				{#if result.ok}
					<div class="msg ok">
						✓ Completed in {fmtMs(result.elapsedMs)}
						{#if result.rowsAffected > 0}· {result.rowsAffected.toLocaleString()} row(s) affected{/if}
					</div>
				{/if}
				{#if !result.error && !result.messages.length && !result.ok}
					<div class="msg">No messages.</div>
				{/if}
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
	.messages {
		flex: 1;
		overflow: auto;
		padding: 10px 14px;
		font-family: var(--mono);
		font-size: 12.5px;
	}
	.msg {
		padding: 2px 0;
		color: var(--text);
		white-space: pre-wrap;
	}
	.msg.error {
		color: var(--error);
	}
	.msg.warn {
		color: var(--warn);
	}
	.msg.ok {
		color: var(--ok);
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
