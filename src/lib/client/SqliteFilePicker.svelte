<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type FileEntry } from './api';

	let {
		initialPath,
		onSelect,
		onClose
	}: { initialPath: string; onSelect: (path: string) => void; onClose: () => void } = $props();

	let location = $state('');
	let currentPath = $state('');
	let parent = $state<string | null>(null);
	let roots = $state<string[]>([]);
	let entries = $state<FileEntry[]>([]);
	let selected = $state('');
	let loading = $state(false);
	let error = $state('');

	async function open(target = location) {
		loading = true;
		error = '';
		try {
			const result = await api.files(target);
			location = result.path;
			currentPath = result.path;
			parent = result.parent;
			roots = result.roots;
			entries = result.entries;
			selected = '';
		} catch (caught) {
			error = (caught as Error).message;
		} finally {
			loading = false;
		}
	}

	function activate(entry: FileEntry) {
		if (entry.directory) void open(entry.path);
		else onSelect(entry.path);
	}

	$effect(() => { void open(initialPath); });
</script>

<Modal title="Choose SQLite database" width={680} {onClose}>
	<div class="picker">
		<div class="location">
			<button title="Parent folder" onclick={() => parent && open(parent)} disabled={!parent || loading}>↑</button>
			<input bind:value={location} onkeydown={(event) => event.key === 'Enter' && open()} aria-label="Folder path" />
			<button onclick={() => open()} disabled={loading}>{loading ? 'Loading…' : 'Go'}</button>
		</div>

		{#if roots.length > 1}
			<div class="roots">
				{#each roots as root}<button onclick={() => open(root)}>{root}</button>{/each}
			</div>
		{/if}

		<div class="files" role="listbox" aria-label="Files in {currentPath}">
			{#each entries as entry (entry.path)}
				<button
					class:folder={entry.directory}
					class:sqlite={entry.sqlite}
					class:selected={selected === entry.path}
					onclick={() => (selected = entry.path)}
					ondblclick={() => activate(entry)}>
					<span class="icon">{entry.directory ? '📁' : '▤'}</span>
					<span>{entry.name}</span>
					{#if entry.sqlite}<span class="tag">SQLite</span>{/if}
				</button>
			{/each}
			{#if !loading && entries.length === 0}<div class="empty">This folder is empty.</div>{/if}
		</div>

		<p>Double-click a folder to open it or a database file to choose it. Files ending in .db, .db3, .sqlite, or .sqlite3 are highlighted.</p>
		{#if error}<div class="error">{error}</div>{/if}
		<div class="actions">
			<button onclick={onClose}>Cancel</button>
			<button class="primary" disabled={!selected || entries.find((entry) => entry.path === selected)?.directory} onclick={() => onSelect(selected)}>Choose file</button>
		</div>
	</div>
</Modal>

<style>
	.picker { display: grid; gap: 10px; }
	.location { display: grid; grid-template-columns: auto 1fr auto; gap: 7px; }
	.location input { min-width: 0; }
	input, button { background: var(--bg); border: 1px solid var(--border); border-radius: 5px; color: var(--text); padding: 7px 9px; }
	button { cursor: pointer; } button:disabled { cursor: default; opacity: .55; }
	.roots { display: flex; gap: 5px; flex-wrap: wrap; }
	.roots button { padding: 3px 8px; font-size: 11px; }
	.files { height: 330px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); padding: 4px; }
	.files > button { width: 100%; border: 0; background: transparent; display: grid; grid-template-columns: 22px 1fr auto; gap: 6px; text-align: left; align-items: center; }
	.files > button:hover, .files > button.selected { background: var(--panel2); }
	.files > button.folder { color: var(--head-text); }
	.files > button.sqlite { color: var(--accent); }
	.icon { text-align: center; } .tag { color: var(--muted); font-size: 10px; }
	.empty { color: var(--muted); padding: 18px; text-align: center; }
	p { color: var(--muted); font-size: 11.5px; margin: 0; }
	.error { color: var(--error); font-size: 12px; }
	.actions { display: flex; justify-content: flex-end; gap: 8px; }
	button.primary { background: var(--accent); color: white; border-color: var(--accent); }
</style>
