<script module lang="ts">
	export interface MenuItem {
		label: string;
		action: () => void;
	}
</script>

<script lang="ts">
	let {
		x,
		y,
		items,
		onClose
	}: { x: number; y: number; items: MenuItem[]; onClose: () => void } = $props();

	let el: HTMLDivElement | undefined = $state();

	// Keep the menu on-screen
	const pos = $derived.by(() => {
		const w = 200;
		const h = items.length * 30 + 10;
		return {
			left: Math.min(x, window.innerWidth - w - 8),
			top: Math.min(y, window.innerHeight - h - 8)
		};
	});

	function pick(item: MenuItem) {
		onClose();
		item.action();
	}
</script>

<svelte:window
	onkeydown={(e) => e.key === 'Escape' && onClose()}
	onmousedown={(e) => el && !el.contains(e.target as Node) && onClose()}
	onblur={onClose}
/>

<div class="menu" bind:this={el} style="left:{pos.left}px; top:{pos.top}px;" role="menu" tabindex="-1">
	{#each items as item (item.label)}
		<button class="item" role="menuitem" onclick={() => pick(item)}>{item.label}</button>
	{/each}
</div>

<style>
	.menu {
		position: fixed;
		z-index: 90;
		min-width: 190px;
		background: var(--panel2);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		padding: 4px;
		display: flex;
		flex-direction: column;
	}
	.item {
		background: none;
		border: none;
		color: var(--text);
		font-size: 12.5px;
		text-align: left;
		padding: 7px 12px;
		border-radius: 5px;
		cursor: pointer;
		white-space: nowrap;
	}
	.item:hover {
		background: var(--accent);
		color: #fff;
	}
</style>
