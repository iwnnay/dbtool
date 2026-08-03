<script lang="ts">
	import { EditorView, keymap } from '@codemirror/view';
	import { EditorSelection, EditorState, Prec } from '@codemirror/state';
	import { basicSetup } from 'codemirror';
	import { selectNextOccurrence } from '@codemirror/search';
	import { sql, MSSQL } from '@codemirror/lang-sql';
	import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
	import { tags as t } from '@lezer/highlight';
	import { statementAt } from '$lib/sql/split';
	import { columnCompletionSource } from './columnCompletion';
	import { app } from './app.svelte';
	import { catalog } from './catalog.svelte';
	import { api, type Sheet } from './api';

	let { sheet }: { sheet: Sheet } = $props();

	let host: HTMLDivElement | undefined = $state();
	let view: EditorView | null = null;
	// Per-sheet editor state so undo history + cursor survive tab switches.
	const states = new Map<string, EditorState>();
	let currentId: string | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	// Zone-aware table/column completion (columnCompletion.ts) — the source
	// reads the current sheet's connection and the shared catalog on each
	// request, so no reconfiguration is needed when either changes.
	const columnSource = columnCompletionSource(() => ({
		server: sheet.server,
		database: sheet.database
	}));

	function sqlExt() {
		const s = sql({ dialect: MSSQL, upperCaseKeywords: true });
		return [s, s.language.data.of({ autocomplete: columnSource })];
	}

	const theme = EditorView.theme(
		{
			'&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg)' },
			'.cm-content': { fontFamily: 'var(--mono)', caretColor: 'var(--text)' },
			'.cm-cursor': { borderLeftColor: 'var(--text)' },
			'.cm-gutters': {
				backgroundColor: 'var(--bg)',
				color: 'var(--muted)',
				border: 'none',
				borderRight: '1px solid var(--border)'
			},
			'.cm-activeLine': { backgroundColor: 'var(--line-hl)' },
			'.cm-activeLineGutter': { backgroundColor: 'var(--line-hl)', color: 'var(--text)' },
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
				backgroundColor: 'var(--sel-bg) !important'
			},
			'.cm-scroller': { overflow: 'auto' },
			'&.cm-focused': { outline: 'none' }
		},
		{ dark: true }
	);

	const highlight = HighlightStyle.define([
		{ tag: t.keyword, color: '#61a1ff', fontWeight: '600' },
		{ tag: t.operator, color: '#c7d2e4' },
		{ tag: t.string, color: '#e8b45e' },
		{ tag: t.number, color: '#6fd3a3' },
		{ tag: t.comment, color: '#5b6b87', fontStyle: 'italic' },
		{ tag: t.typeName, color: '#4fc1c9' },
		{ tag: t.function(t.variableName), color: '#c792ea' },
		{ tag: t.special(t.string), color: '#e8b45e' }
	]);

	function runCurrent(v: EditorView): boolean {
		const doc = v.state.doc.toString();
		const sel = v.state.selection.main;
		let text: string;
		if (!sel.empty) {
			text = v.state.sliceDoc(sel.from, sel.to);
		} else {
			const stmt = statementAt(doc, sel.head);
			if (!stmt) return true;
			text = stmt.text;
		}
		void app.run(sheet, text, doc);
		return true;
	}

	function runAll(v: EditorView): boolean {
		const doc = v.state.doc.toString();
		if (doc.trim()) void app.run(sheet, doc, doc);
		return true;
	}

	/** Ctrl+D: duplicate the current line (or the selection), cursor on the copy. */
	function duplicateLine(v: EditorView): boolean {
		const tr = v.state.changeByRange((r) => {
			if (r.empty) {
				const line = v.state.doc.lineAt(r.head);
				const insert = '\n' + line.text;
				return {
					changes: { from: line.to, insert },
					range: EditorSelection.cursor(r.head + insert.length)
				};
			}
			const text = v.state.sliceDoc(r.from, r.to);
			return {
				changes: { from: r.to, insert: text },
				range: EditorSelection.range(r.to, r.to + text.length)
			};
		});
		v.dispatch(tr, { scrollIntoView: true, userEvent: 'input.duplicateline' });
		return true;
	}

	/** Ctrl+Alt+Up/Down: add a cursor on the line above/below the outermost one. */
	function addCursorVertical(v: EditorView, dir: 1 | -1): boolean {
		const sel = v.state.selection;
		const edge = dir === 1 ? sel.ranges[sel.ranges.length - 1] : sel.ranges[0];
		const next = v.moveVertically(EditorSelection.cursor(edge.head, edge.assoc), dir === 1);
		if (next.head === edge.head) return true;
		v.dispatch({
			selection: EditorSelection.create([...sel.ranges, next], sel.ranges.length),
			scrollIntoView: true
		});
		return true;
	}

	function scheduleSave(id: string, sqlText: string) {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			void api.updateSheet(id, { sql: sqlText }).catch(() => {});
		}, 1500);
	}

	function makeState(s: Sheet): EditorState {
		return EditorState.create({
			doc: s.sql,
			extensions: [
				Prec.highest(
					keymap.of([
						{ key: 'Mod-Enter', run: runCurrent },
						{ key: 'Mod-Shift-Enter', run: runAll },
						{ key: 'Mod-d', run: duplicateLine },
						{ key: 'Mod-Shift-d', run: selectNextOccurrence },
						{ key: 'Mod-Alt-ArrowDown', run: (v) => addCursorVertical(v, 1) },
						{ key: 'Mod-Alt-ArrowUp', run: (v) => addCursorVertical(v, -1) },
						{
							key: 'Mod-s',
							run: (v) => {
								void api.updateSheet(s.id, { sql: v.state.doc.toString() }).catch(() => {});
								return true;
							}
						}
					])
				),
				basicSetup,
				EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
				sqlExt(),
				theme,
				syntaxHighlighting(highlight),
				EditorView.updateListener.of((u) => {
					if (u.docChanged) {
						const text = u.state.doc.toString();
						app.setSheetSql(s.id, text);
						scheduleSave(s.id, text);
					}
				})
			]
		});
	}

	// Swap editor state when the active sheet changes.
	$effect(() => {
		const id = sheet.id;
		if (!host) return;
		if (!view) {
			view = new EditorView({ state: states.get(id) ?? makeState(sheet), parent: host });
			currentId = id;
			view.focus();
			return;
		}
		if (currentId !== id) {
			if (currentId) states.set(currentId, view.state);
			view.setState(states.get(id) ?? makeState(sheet));
			currentId = id;
			view.focus();
		}
	});

	// Make sure the sheet's database is indexed so completion has something to
	// offer even before the tree is expanded.
	$effect(() => {
		if (sheet.server && sheet.database) void catalog.loadObjects(sheet.server, sheet.database);
	});

	$effect(() => {
		return () => {
			if (saveTimer) clearTimeout(saveTimer);
			view?.destroy();
			view = null;
		};
	});

	/** Toolbar-triggered runs (keyboard lives in the CodeMirror keymap). */
	export function triggerRunCurrent(): void {
		if (view) runCurrent(view);
	}
	export function triggerRunAll(): void {
		if (view) runAll(view);
	}

	/** Append SQL at the end of the sheet (used by "Add Query"). */
	export function appendText(sqlText: string): void {
		if (!view) return;
		const doc = view.state.doc;
		const sep = doc.length === 0 ? '' : doc.sliceString(Math.max(0, doc.length - 1)) === '\n' ? '\n' : '\n\n';
		const insert = sep + sqlText + '\n';
		view.dispatch({
			changes: { from: doc.length, insert },
			selection: { anchor: doc.length + insert.length },
			scrollIntoView: true
		});
		view.focus();
	}

	/** Insert text at the cursor (used by the explorer tree). */
	export function insertText(text: string): void {
		if (!view) return;
		const sel = view.state.selection.main;
		view.dispatch({
			changes: { from: sel.from, to: sel.to, insert: text },
			selection: { anchor: sel.from + text.length }
		});
		view.focus();
	}
</script>

<div class="editor-host" bind:this={host}></div>

<style>
	.editor-host {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.editor-host :global(.cm-editor) {
		height: 100%;
	}
</style>
