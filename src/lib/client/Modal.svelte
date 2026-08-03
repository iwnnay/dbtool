<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		width = 560,
		onClose,
		children
	}: { title: string; width?: number; onClose: () => void; children: Snippet } = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="modal" role="dialog" aria-label={title} style="width:{width}px;">
		<div class="modal-head">
			<span class="modal-title">{title}</span>
			<button class="modal-close" onclick={onClose}>✕</button>
		</div>
		<div class="modal-body">
			{@render children()}
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(5, 8, 15, 0.6);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 9vh;
		z-index: 100;
	}
	.modal {
		background: var(--panel);
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
		max-width: calc(100vw - 40px);
		max-height: 80vh;
		display: flex;
		flex-direction: column;
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		flex: none;
	}
	.modal-title {
		font-size: 13.5px;
		font-weight: 700;
		color: var(--head-text);
	}
	.modal-close {
		background: none;
		border: none;
		color: var(--muted);
		font-size: 13px;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 4px;
	}
	.modal-close:hover {
		color: var(--text);
		background: var(--panel2);
	}
	.modal-body {
		padding: 14px 16px;
		overflow: auto;
		min-height: 0;
	}
</style>
