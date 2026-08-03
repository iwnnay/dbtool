<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type DbProperties } from './api';

	let {
		server,
		database,
		onClose
	}: { server: string; database: string; onClose: () => void } = $props();

	let info = $state<DbProperties | null>(null);
	let error = $state('');

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
			<dt>Server</dt>
			<dd>{server}</dd>
			<dt>Owner</dt>
			<dd>{info.owner ?? '—'}</dd>
			<dt>Collation</dt>
			<dd>{info.collation ?? '—'}</dd>
			<dt>Active connections</dt>
			<dd>{info.userConnections ?? '—'}</dd>
			<dt>Data size</dt>
			<dd>{mb(info.dataMb)}</dd>
			<dt>Log size</dt>
			<dd>{mb(info.logMb)}</dd>
			<dt>Created</dt>
			<dd>{info.createDate.replace('T', ' ').slice(0, 19)}</dd>
			<dt>State</dt>
			<dd>{info.state}</dd>
			<dt>Recovery model</dt>
			<dd>{info.recoveryModel}</dd>
			<dt>Compatibility level</dt>
			<dd>{info.compatibilityLevel}</dd>
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
