<script lang="ts">
	import Modal from './Modal.svelte';

	let { onClose }: { onClose: () => void } = $props();

	interface Shortcut {
		keys: string[];
		what: string;
	}

	const groups: { title: string; shortcuts: Shortcut[] }[] = [
		{
			title: 'Running queries',
			shortcuts: [
				{ keys: ['Ctrl', 'Enter'], what: 'Run the statement under the cursor, or the selection' },
				{ keys: ['Ctrl', 'Shift', 'Enter'], what: 'Run the whole sheet' },
				{ keys: ['Ctrl', 'S'], what: 'Save the sheet now (it also auto-saves)' }
			]
		},
		{
			title: 'Editing',
			shortcuts: [
				{ keys: ['Tab'], what: 'Accept autocomplete; otherwise indent the current line' },
				{ keys: ['Shift', 'Tab'], what: 'Move down autocomplete; otherwise outdent the line' },
				{ keys: ['Enter'], what: 'Insert a new line without accepting autocomplete' },
				{ keys: ['Ctrl', 'J'], what: 'Join the line below to the current line' },
				{ keys: ['Ctrl', 'D'], what: 'Duplicate the current line' },
				{ keys: ['Ctrl', 'Shift', 'D'], what: 'Select the next occurrence of the selection' },
				{ keys: ['Ctrl', 'Alt', '↓'], what: 'Add a cursor on the line below' },
				{ keys: ['Ctrl', 'Alt', '↑'], what: 'Add a cursor on the line above' },
				{ keys: ['Alt', 'Click'], what: 'Add a cursor where you click' },
				{ keys: ['Ctrl', 'Space'], what: 'Table and column autocomplete' }
			]
		},
		{
			title: 'Results grid',
			shortcuts: [
				{ keys: ['Click', 'drag'], what: 'Select a block of cells · Shift+Click extends the block' },
				{ keys: ['Click'], what: 'Row number selects the row · column header selects the column' },
				{ keys: ['Ctrl', 'A'], what: 'Select the whole result set' },
				{ keys: ['Ctrl', 'C'], what: 'Copy the selection as TSV' },
				{ keys: ['Right-click'], what: 'Copy the selection, with or without headers' },
				{ keys: ['Double-click'], what: 'Copy a single cell' }
			]
		},
		{
			title: 'Explorer',
			shortcuts: [
				{ keys: ['Double-click'], what: 'Table — insert a 100-row SELECT' },
				{ keys: ['Double-click'], what: 'Procedure — open its definition in a new sheet' },
				{ keys: ['Double-click'], what: 'Column — insert the column name at the cursor' },
				{ keys: ['Double-click'], what: 'Database — point the current sheet at it' },
				{ keys: ['Right-click'], what: 'Actions for a server, database, table or procedure' }
			]
		},
		{
			title: 'Sheets and windows',
			shortcuts: [
				{ keys: ['Double-click'], what: 'Sheet tab — rename it' },
				{ keys: ['Esc'], what: 'Close the open dialog' },
				{ keys: ['Enter'], what: 'Send an Ask message · Shift+Enter for a new line' }
			]
		}
	];
</script>

<Modal title="Keyboard shortcuts" width={620} {onClose}>
	<div class="shortcuts">
		{#each groups as group (group.title)}
			<section>
				<h3>{group.title}</h3>
				{#each group.shortcuts as shortcut, index (index)}
					<div class="row">
						<span class="keys">
							{#each shortcut.keys as key, keyIndex (keyIndex)}
								{#if keyIndex > 0}<span class="plus">+</span>{/if}
								<kbd>{key}</kbd>
							{/each}
						</span>
						<span class="what">{shortcut.what}</span>
					</div>
				{/each}
			</section>
		{/each}
	</div>
</Modal>

<style>
	.shortcuts {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	section h3 {
		margin: 0 0 6px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 3px 0;
		font-size: 12.5px;
	}
	.keys {
		flex: none;
		width: 168px;
		text-align: right;
		white-space: nowrap;
	}
	.what {
		color: var(--text);
	}
	kbd {
		background: var(--panel2);
		border: 1px solid var(--border-strong);
		border-radius: 4px;
		padding: 1px 6px;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text);
	}
	.plus {
		color: var(--muted);
		font-size: 10px;
		margin: 0 2px;
	}
</style>
