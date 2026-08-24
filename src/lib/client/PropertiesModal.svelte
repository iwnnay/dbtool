<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type DbProperties } from './api';
	import { app } from './app.svelte';

	let {
		server,
		database,
		onClose
	}: { server: string; database: string; onClose: () => void } = $props();

	let info = $state<DbProperties | null>(null);
	let error = $state('');
	const engine = $derived(app.connection(server)?.type ?? 'mssql');

	$effect(() => {
		api
			.properties(server, database)
			.then((r) => (info = r.properties))
			.catch((e) => (error = (e as Error).message));
	});

	function mb(v: number | null): string {
		if (v == null) return '—';
		return v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${v.toLocaleString()} MB`;
	}
</script>

<Modal title="Properties — {database}" width={480} {onClose}>
	{#if error}
		<div class="note err">⚠ {error}</div>
	{:else if !info}
		<div class="note">Loading…</div>
	{:else}
		<dl>
			<dt>Connection</dt>
			<dd>{app.connection(server)?.name ?? server}</dd>
			{#if engine !== 'sqlite'}<dt>Owner / user</dt><dd>{info.owner ?? '—'}</dd>{/if}
			<dt>Collation</dt>
			<dd>{info.collation ?? '—'}</dd>
			{#if engine !== 'sqlite'}<dt>Active connections</dt><dd>{info.userConnections ?? '—'}</dd>{/if}
			<dt>Data size</dt>
			<dd>{mb(info.dataMb)}</dd>
			{#if engine === 'mssql'}<dt>Log size</dt><dd>{mb(info.logMb)}</dd>{/if}
			{#if info.createDate}<dt>Created</dt><dd>{info.createDate.replace('T', ' ').slice(0, 19)}</dd>{/if}
			<dt>State</dt>
			<dd>{info.state}</dd>
			<dt>{engine === 'postgres' ? 'Encoding' : engine === 'sqlite' ? 'Access' : 'Recovery model'}</dt>
			<dd>{info.recoveryModel}</dd>
			{#if engine === 'mssql'}<dt>Compatibility level</dt><dd>{info.compatibilityLevel}</dd>{/if}
		</dl>
	{/if}
</Modal>

<style>
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 7px 20px;
		margin: 0;
		font-size: 12.5px;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		font-family: var(--mono);
		color: var(--text);
	}
	.note {
		color: var(--muted);
		font-size: 12.5px;
	}
	.note.err {
		color: var(--error);
	}
</style>
