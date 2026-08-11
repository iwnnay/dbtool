<script lang="ts">
	import '$lib/client/theme.css';
	import { app } from '$lib/client/app.svelte';
	import { catalog } from '$lib/client/catalog.svelte';
	import Explorer from '$lib/client/Explorer.svelte';
	import Editor from '$lib/client/Editor.svelte';
	import ResultsPanel from '$lib/client/ResultsPanel.svelte';
	import AskModal from '$lib/client/AskModal.svelte';
	import ShortcutsModal from '$lib/client/ShortcutsModal.svelte';

	let editorRef: Editor | undefined = $state();
	let askOpen = $state(false);
	let shortcutsOpen = $state(false);

	function appendSql(sql: string) {
		if (app.activeSheet) editorRef?.appendText(sql);
		else void app.newSheet({ sql });
	}

	// layout
	let explorerW = $state(290);
	let resultsH = $state(340);

	// per-server database dropdown options
	$effect(() => {
		const server = app.activeSheet?.server;
		if (server) void catalog.loadDatabases(server);
	});

	$effect(() => {
		void app.init();
	});

	// tab rename
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	function startRename(id: string, current: string) {
		renamingId = id;
		renameValue = current;
	}
	function commitRename() {
		if (renamingId && renameValue.trim()) {
			void app.patchSheet(renamingId, { name: renameValue.trim() });
		}
		renamingId = null;
	}

	function setServer(server: string) {
		const s = app.activeSheet;
		if (s) void app.patchSheet(s.id, { server, database: '' });
	}
	function setDatabase(database: string) {
		const s = app.activeSheet;
		if (s) void app.patchSheet(s.id, { database });
	}
	function useDatabase(server: string, database: string) {
		const s = app.activeSheet;
		if (s) void app.patchSheet(s.id, { server, database });
	}

	// splitter drags
	function dragX(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startW = explorerW;
		const move = (ev: PointerEvent) => {
			explorerW = Math.min(Math.max(startW + ev.clientX - startX, 180), 560);
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	function dragY(e: PointerEvent) {
		e.preventDefault();
		const startY = e.clientY;
		const startH = resultsH;
		const move = (ev: PointerEvent) => {
			resultsH = Math.min(Math.max(startH - (ev.clientY - startY), 100), window.innerHeight - 220);
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	const running = $derived(app.activeRun?.running ?? false);
	const result = $derived(app.activeRun?.result ?? null);
	const totalRows = $derived(
		result?.resultSets.reduce((a, rs) => a + rs.rowCount, 0) ?? 0
	);
</script>

<svelte:head><title>dbtool{app.activeSheet ? ` — ${app.activeSheet.name}` : ''}</title></svelte:head>

<div class="shell">
	<header class="topbar">
		<div class="logo">db<span>tool</span></div>
		{#if app.activeSheet}
			{@const sheet = app.activeSheet}
			<select value={sheet.server} onchange={(e) => setServer(e.currentTarget.value)} title="Server">
				<option value="" disabled>server…</option>
				{#each app.servers as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
			<select
				value={sheet.database}
				onchange={(e) => setDatabase(e.currentTarget.value)}
				title="Database"
				disabled={!sheet.server}
			>
				<option value="" disabled>database…</option>
				{#each catalog.databases[sheet.server] ?? [] as db (db.name)}
					<option value={db.name}>{db.name}</option>
				{/each}
			</select>
			<button
				class="run-btn"
				onclick={() => editorRef?.triggerRunCurrent()}
				disabled={running}
				title="Run statement at cursor / selection (Ctrl+Enter)"
			>
				▶ Run
			</button>
			<button
				class="run-btn all"
				onclick={() => editorRef?.triggerRunAll()}
				disabled={running}
				title="Run everything (Ctrl+Shift+Enter)"
			>
				▶▶ Run All
			</button>
			{#if running}
				<button class="run-btn cancel" onclick={() => app.cancel(sheet.id)}>■ Cancel</button>
			{/if}
		{/if}
		<span class="top-spacer"></span>
		<button
			class="ask-btn"
			onclick={() => (askOpen = true)}
			title="Ask general SQL Server questions (no database context)"
		>
			✦ Ask
		</button>
	</header>

	<div class="body">
		<aside style="width:{explorerW}px;">
			<Explorer
				onInsert={(t) => editorRef?.insertText(t)}
				onAppendSql={(t) => editorRef?.appendText(t)}
				onUseDatabase={useDatabase}
			/>
		</aside>
		<div class="vsplit" role="separator" aria-orientation="vertical" onpointerdown={dragX}></div>

		<main>
			<div class="tabs">
				{#each app.sheets as s (s.id)}
					<div
						class="tab"
						class:active={s.id === app.activeSheetId}
						role="button"
						tabindex="0"
						onclick={() => (app.activeSheetId = s.id)}
						onkeydown={(e) => e.key === 'Enter' && (app.activeSheetId = s.id)}
						ondblclick={() => startRename(s.id, s.name)}
						title="{s.database ? `${s.server} · ${s.database}` : 'not connected'} — double-click to rename"
					>
						{#if renamingId === s.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="rename"
								bind:value={renameValue}
								autofocus
								onblur={commitRename}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename();
									if (e.key === 'Escape') renamingId = null;
								}}
								onclick={(e) => e.stopPropagation()}
							/>
						{:else}
							<span class="dot" class:on={!!s.database} class:busy={app.runs[s.id]?.running}></span>
							<span class="tab-name">{s.name}</span>
							{#if s.database}<span class="tab-db">{s.database}</span>{/if}
							<button
								class="close"
								title="Close sheet"
								onclick={(e) => {
									e.stopPropagation();
									void app.closeSheet(s.id);
								}}>×</button
							>
						{/if}
					</div>
				{/each}
				<button class="new-tab" title="New query sheet" onclick={() => app.newSheet()}>+</button>
			</div>

			<div class="editor-pane">
				{#if app.activeSheet}
					<Editor bind:this={editorRef} sheet={app.activeSheet} />
				{/if}
			</div>

			<div class="hsplit" role="separator" aria-orientation="horizontal" onpointerdown={dragY}></div>

			<div class="results-pane" style="height:{resultsH}px;">
				{#if app.activeSheet}
					<ResultsPanel sheet={app.activeSheet} onAppendSql={appendSql} />
				{/if}
			</div>
		</main>
	</div>

	{#if askOpen}
		<AskModal scope="general" onAppendSql={appendSql} onClose={() => (askOpen = false)} />
	{/if}

	{#if shortcutsOpen}
		<ShortcutsModal onClose={() => (shortcutsOpen = false)} />
	{/if}

	<footer class="statusbar">
		{#if app.activeSheet}
			{@const s = app.activeSheet}
			<span class="seg accent">{s.server || 'no server'}</span>
			<span class="seg">{s.database || 'no database'}</span>
			<span class="seg">{running ? 'Executing…' : 'Ready'}</span>
			{#if app.flashMsg}
				<span class="seg flash">{app.flashMsg}</span>
			{/if}
			<span class="spacer"></span>
			{#if result}
				{#if result.ok}
					<span class="seg ok">✓ {(result.elapsedMs / 1000).toFixed(2)}s</span>
				{:else}
					<span class="seg err">✕ error</span>
				{/if}
				<span class="seg">{totalRows.toLocaleString()} rows</span>
			{/if}
		{/if}
		<button
			class="key-btn"
			onclick={() => (shortcutsOpen = true)}
			title="Keyboard shortcuts"
			aria-label="Keyboard shortcuts"
		>
			<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
				<circle cx="8" cy="8" r="4.1" fill="none" stroke="currentColor" stroke-width="2.1" />
				<path
					d="M11 11 L19.5 19.5 M16.5 16.5 L14.6 18.4 M19.5 19.5 L17.6 21.4"
					fill="none"
					stroke="currentColor"
					stroke-width="2.1"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</footer>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		flex: none;
	}
	.logo {
		font-weight: 800;
		font-size: 15px;
		letter-spacing: -0.02em;
		margin-right: 10px;
		color: var(--head-text);
	}
	.logo span {
		color: var(--accent);
	}
	.run-btn {
		background: var(--accent);
		border: none;
		border-radius: 6px;
		color: #fff;
		font-size: 12.5px;
		font-weight: 600;
		padding: 5px 14px;
		cursor: pointer;
	}
	.run-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.run-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.run-btn.all {
		background: var(--panel2);
		border: 1px solid var(--border-strong);
	}
	.run-btn.all:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--panel2);
	}
	.run-btn.cancel {
		background: transparent;
		border: 1px solid var(--error);
		color: var(--error);
	}
	.top-spacer {
		flex: 1;
	}
	.ask-btn {
		background: var(--panel2);
		border: 1px solid var(--border-strong);
		border-radius: 6px;
		color: var(--text);
		font-size: 12.5px;
		font-weight: 600;
		padding: 5px 14px;
		cursor: pointer;
	}
	.ask-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.key-btn {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		border-radius: 4px;
		color: var(--muted);
		cursor: pointer;
		padding: 1px 4px;
		line-height: 1;
	}
	.key-btn:hover {
		color: var(--accent);
		background: var(--panel2);
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	aside {
		flex: none;
		min-width: 0;
	}
	.vsplit {
		flex: none;
		width: 4px;
		cursor: col-resize;
		background: transparent;
	}
	.vsplit:hover {
		background: var(--accent);
		opacity: 0.4;
	}
	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.tabs {
		display: flex;
		align-items: center;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		padding: 4px 6px 0;
		flex: none;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		font-size: 12.5px;
		color: var(--muted);
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: 7px 7px 0 0;
		cursor: pointer;
		white-space: nowrap;
		max-width: 240px;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		background: var(--bg);
		color: var(--text);
		border-color: var(--border);
	}
	.tab-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab-db {
		color: var(--muted);
		font-size: 10.5px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--border-strong);
		flex: none;
	}
	.dot.on {
		background: var(--ok);
	}
	.dot.busy {
		background: var(--warn);
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
	.tab .close {
		background: none;
		border: none;
		color: var(--muted);
		font-size: 14px;
		cursor: pointer;
		padding: 0 2px;
		border-radius: 3px;
		line-height: 1;
	}
	.tab .close:hover {
		color: var(--error);
	}
	.rename {
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: 4px;
		color: var(--text);
		font-size: 12px;
		padding: 2px 6px;
		width: 120px;
		outline: none;
	}
	.new-tab {
		background: none;
		border: none;
		color: var(--muted);
		font-size: 16px;
		cursor: pointer;
		padding: 2px 10px;
	}
	.new-tab:hover {
		color: var(--accent);
	}
	.editor-pane {
		flex: 1;
		min-height: 60px;
	}
	.hsplit {
		flex: none;
		height: 4px;
		cursor: row-resize;
		background: var(--border);
	}
	.hsplit:hover {
		background: var(--accent);
	}
	.results-pane {
		flex: none;
		min-height: 0;
	}
	.statusbar {
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--panel);
		border-top: 1px solid var(--border);
		padding: 3px 10px;
		font-size: 11.5px;
		color: var(--muted);
		flex: none;
	}
	.seg {
		padding: 1px 8px;
		border-right: 1px solid var(--border);
	}
	.seg:last-child {
		border-right: none;
	}
	.seg.accent {
		color: var(--accent);
	}
	.seg.ok {
		color: var(--ok);
	}
	.seg.err {
		color: var(--error);
	}
	.seg.flash {
		color: var(--warn);
	}
	.spacer {
		flex: 1;
	}
</style>
