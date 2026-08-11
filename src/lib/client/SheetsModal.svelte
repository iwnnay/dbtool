<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type Sheet } from './api';
	import { app } from './app.svelte';

	let { onClose }: { onClose: () => void } = $props();

	let sheets = $state<Sheet[]>([]);
	let search = $state('');
	let loading = $state(true);
	let loadError = $state('');
	let confirmingDelete = $state<string | null>(null);

	async function load() {
		loading = true;
		loadError = '';
		try {
			sheets = (await api.savedSheets()).sheets;
		} catch (caught) {
			loadError = (caught as Error).message;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void load();
	});

	const matching = $derived.by(() => {
		const term = search.trim().toLowerCase();
		const filtered = term
			? sheets.filter((sheet) =>
					`${sheet.name} ${sheet.database} ${sheet.server} ${sheet.sql}`
						.toLowerCase()
						.includes(term)
				)
			: sheets;
		return [...filtered].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
	});

	function isOpen(sheet: Sheet): boolean {
		return app.sheets.some((openSheet) => openSheet.id === sheet.id);
	}

	async function open(sheet: Sheet) {
		await app.openSavedSheet(sheet);
		onClose();
	}

	async function remove(sheet: Sheet) {
		if (confirmingDelete !== sheet.id) {
			confirmingDelete = sheet.id;
			setTimeout(() => {
				if (confirmingDelete === sheet.id) confirmingDelete = null;
			}, 4000);
			return;
		}
		confirmingDelete = null;
		try {
			await app.deleteSheet(sheet.id);
			await load();
		} catch (caught) {
			loadError = (caught as Error).message;
		}
	}

	function when(iso: string): string {
		const at = new Date(iso);
		const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
		if (days === 0) return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days} days ago`;
		return at.toLocaleDateString();
	}

	function preview(sql: string): string {
		const line = sql.trim().split('\n').find((candidate) => candidate.trim()) ?? '(empty)';
		return line.length > 120 ? `${line.slice(0, 120)}…` : line;
	}
</script>

<Modal title="Saved sheets" width={820} {onClose}>
	<div class="sheets">
		<div class="toolbar">
			<input placeholder="Search name, database or SQL…" bind:value={search} />
			<span class="muted">
				{#if loading}loading…{:else}{matching.length} of {sheets.length}{/if}
			</span>
			{#if loadError}<span class="bad">⚠ {loadError}</span>{/if}
		</div>

		<div class="rows">
			{#if !loading && matching.length === 0}
				<div class="empty">{search ? 'Nothing matches that search.' : 'No saved sheets yet.'}</div>
			{/if}
			{#each matching as sheet (sheet.id)}
				<div class="row">
					<button class="pick" onclick={() => open(sheet)} title="Open this sheet in a tab">
						<span class="name">{sheet.name}</span>
						{#if isOpen(sheet)}<span class="badge">open</span>{/if}
						<span class="sql">{preview(sheet.sql)}</span>
						<span class="db">{sheet.database || '—'}</span>
						<span class="when">{when(sheet.updatedAt)}</span>
					</button>
					<button
						class="mini"
						class:danger={confirmingDelete === sheet.id}
						onclick={() => remove(sheet)}
						title="Delete this sheet permanently"
					>
						{confirmingDelete === sheet.id ? 'Really delete?' : 'Delete'}
					</button>
				</div>
			{/each}
		</div>
	</div>
</Modal>

<style>
	.sheets {
		display: flex;
		flex-direction: column;
		height: 60vh;
		min-height: 340px;
		gap: 8px;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.toolbar input {
		flex: 0 1 320px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-size: 12.5px;
		padding: 5px 9px;
		outline: none;
	}
	.toolbar input:focus {
		border-color: var(--accent);
	}
	.muted {
		color: var(--muted);
		font-size: 11.5px;
	}
	.bad {
		color: var(--error);
		font-size: 11.5px;
	}
	.rows {
		flex: 1;
		overflow: auto;
		min-height: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.empty {
		padding: 28px;
		text-align: center;
		color: var(--muted);
		font-size: 12.5px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-right: 8px;
		border-bottom: 1px solid var(--border);
	}
	.row:last-child {
		border-bottom: none;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		color: var(--text);
		text-align: left;
		padding: 7px 10px;
		cursor: pointer;
		font-size: 12.5px;
	}
	.pick:hover {
		background: var(--panel2);
	}
	.name {
		flex: none;
		font-weight: 600;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		flex: none;
		background: var(--panel2);
		border-radius: 8px;
		color: var(--ok);
		font-size: 10px;
		padding: 0 6px;
	}
	.sql {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 11.5px;
	}
	.db {
		flex: none;
		color: var(--accent);
		font-size: 11px;
	}
	.when {
		flex: none;
		color: var(--muted);
		font-size: 11px;
		min-width: 74px;
		text-align: right;
	}
	.mini {
		flex: none;
		background: var(--panel2);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--muted);
		font-size: 11px;
		padding: 3px 9px;
		cursor: pointer;
	}
	.mini:hover {
		border-color: var(--error);
		color: var(--error);
	}
	.mini.danger {
		border-color: var(--error);
		color: var(--error);
	}
</style>
