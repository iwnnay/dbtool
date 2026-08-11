<script lang="ts">
	import { api, type HistoryEntry } from './api';
	import { app } from './app.svelte';

	let { onAppendSql }: { onAppendSql: (sql: string) => void } = $props();

	let entries = $state<HistoryEntry[]>([]);
	let total = $state(0);
	let search = $state('');
	let loading = $state(true);
	let loadError = $state('');
	let expanded = $state<number | null>(null);
	let confirmingClear = $state(false);
	let autoExpandedFor = -1;

	async function load(expandNewest: boolean) {
		loading = true;
		loadError = '';
		try {
			const response = await api.history(search);
			entries = response.entries;
			total = response.total;
			if (expandNewest && entries.length) expanded = entries[0].id;
		} catch (caught) {
			loadError = (caught as Error).message;
		} finally {
			loading = false;
		}
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const term = search;
		const runs = app.completedRuns;
		const isNewRun = runs !== autoExpandedFor;
		autoExpandedFor = runs;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void load(isNewRun), term && !isNewRun ? 250 : 0);
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	async function clearAll() {
		if (!confirmingClear) {
			confirmingClear = true;
			setTimeout(() => (confirmingClear = false), 4000);
			return;
		}
		confirmingClear = false;
		try {
			await api.clearHistory();
			await load(false);
			app.flash('Message and query history cleared');
		} catch (caught) {
			loadError = (caught as Error).message;
		}
	}

	function when(isoTimestamp: string): string {
		const ranAt = new Date(isoTimestamp);
		const today = new Date().toDateString() === ranAt.toDateString();
		const time = ranAt.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		return today ? time : `${ranAt.toLocaleDateString()} ${time}`;
	}

	function elapsed(milliseconds: number): string {
		return milliseconds < 1000
			? `${milliseconds} ms`
			: `${(milliseconds / 1000).toFixed(1)} s`;
	}

	function firstLine(sql: string): string {
		const line = sql.trim().split('\n').find((candidate) => candidate.trim()) ?? '';
		return line.length > 160 ? `${line.slice(0, 160)}…` : line;
	}

	function openInSheet(entry: HistoryEntry) {
		void app.newSheet({
			server: entry.server,
			database: entry.database,
			name: entry.sheetName,
			sql: entry.sql
		});
	}
</script>

<div class="log">
	<div class="toolbar">
		<input placeholder="Search SQL, messages, database or sheet…" bind:value={search} />
		<span class="muted">
			{#if loading}loading…{:else}{entries.length.toLocaleString()} of {total.toLocaleString()} runs{/if}
		</span>
		{#if loadError}<span class="bad">⚠ {loadError}</span>{/if}
		<span class="spacer"></span>
		<button class="btn" class:danger={confirmingClear} onclick={clearAll} disabled={total === 0}>
			{confirmingClear ? 'Click again to erase all' : 'Clear'}
		</button>
	</div>

	<div class="rows">
		{#if !loading && entries.length === 0}
			<div class="empty">
				{search ? 'No runs match that search.' : 'No queries have been run yet.'}
			</div>
		{/if}
		{#each entries as entry (entry.id)}
			{@const open = expanded === entry.id}
			<div class="row">
				<button
					class="summary"
					onclick={() => (expanded = open ? null : entry.id)}
					title="Show the full query and its messages"
				>
					<span class="chev" class:open>▸</span>
					<span class="status" class:ok={entry.ok}>{entry.ok ? '✓' : '✕'}</span>
					<span class="when">{when(entry.ranAt)}</span>
					<span class="sql">{firstLine(entry.sql)}</span>
					<span class="db">{entry.database || '—'}</span>
					<span class="stat">{elapsed(entry.elapsedMs)}</span>
					<span class="stat">{entry.rowCount.toLocaleString()} rows</span>
				</button>
				{#if open}
					<div class="detail">
						<pre>{entry.sql}</pre>
						<div class="msgs">
							{#if entry.error}
								<div class="msg error">✕ {entry.error}</div>
							{/if}
							{#each entry.messages as message, index (index)}
								<div class="msg" class:warn={(message.severity ?? 0) > 10}>{message.text}</div>
							{/each}
							{#if entry.ok}
								<div class="msg ok">
									✓ Completed in {elapsed(entry.elapsedMs)}
									{#if entry.rowsAffected > 0}· {entry.rowsAffected.toLocaleString()} row(s) affected{/if}
								</div>
							{/if}
						</div>
						<div class="meta">
							{entry.server} · {entry.database} · sheet <strong>{entry.sheetName}</strong>
							<span class="spacer"></span>
							<button class="btn" onclick={() => onAppendSql(entry.sql)}>+ Add to sheet</button>
							<button class="btn" onclick={() => openInSheet(entry)}>Open in new sheet</button>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.log {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 10px;
		border-bottom: 1px solid var(--border);
		flex: none;
	}
	.toolbar input {
		flex: 0 1 300px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-size: 12px;
		padding: 3px 8px;
		outline: none;
	}
	.toolbar input:focus {
		border-color: var(--accent);
	}
	.spacer {
		flex: 1;
	}
	.muted {
		color: var(--muted);
		font-size: 11px;
	}
	.bad {
		color: var(--error);
		font-size: 11.5px;
	}
	.btn {
		background: var(--panel2);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		font-size: 11.5px;
		padding: 3px 10px;
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.btn.danger {
		border-color: var(--error);
		color: var(--error);
	}
	.rows {
		flex: 1;
		overflow: auto;
		min-height: 0;
	}
	.empty {
		padding: 28px;
		text-align: center;
		color: var(--muted);
		font-size: 12.5px;
	}
	.row {
		border-bottom: 1px solid var(--border);
	}
	.summary {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		background: none;
		border: none;
		color: var(--text);
		text-align: left;
		padding: 5px 10px;
		cursor: pointer;
		font-size: 12px;
	}
	.summary:hover {
		background: var(--panel);
	}
	.chev {
		flex: none;
		width: 10px;
		color: var(--muted);
		font-size: 9px;
		transition: transform 0.12s;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.status {
		flex: none;
		color: var(--error);
		width: 12px;
	}
	.status.ok {
		color: var(--ok);
	}
	.when {
		flex: none;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 11px;
	}
	.sql {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--mono);
		font-size: 11.5px;
	}
	.db {
		flex: none;
		color: var(--accent);
		font-size: 11px;
	}
	.stat {
		flex: none;
		color: var(--muted);
		font-size: 11px;
		min-width: 62px;
		text-align: right;
	}
	.detail {
		padding: 2px 12px 10px 31px;
		background: var(--panel);
	}
	.detail pre {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 9px 11px;
		margin: 0;
		font-family: var(--mono);
		font-size: 12px;
		overflow-x: auto;
		white-space: pre;
		max-height: 220px;
	}
	.msgs {
		padding: 7px 2px 2px;
		font-family: var(--mono);
		font-size: 12px;
	}
	.msg {
		padding: 2px 0;
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
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		color: var(--muted);
		font-size: 11.5px;
		padding: 8px 0 0;
	}
</style>
