/**
 * Central client state (Svelte 5 runes). One instance for the whole app:
 * sheets + active tab, per-sheet run results, and the registered servers.
 */
import { api, type RunResponse, type Sheet, type SqlResultSet } from './api';

export interface ResultTab {
	id: number;
	label: string;
	title: string;
	resultSet: SqlResultSet;
	pinned: boolean;
	deletedRows: Set<number>;
}

export interface SheetRun {
	running: boolean;
	startedAt: number;
	result: RunResponse | null;
}

const STACKED_KEY = 'dbtool.stackedResults';

function loadStacked(): boolean {
	try {
		return localStorage.getItem(STACKED_KEY) === '1';
	} catch {
		return false;
	}
}

class App {
	servers = $state<string[]>([]);
	sheets = $state<Sheet[]>([]);
	activeSheetId = $state<string | null>(null);
	runs = $state<Record<string, SheetRun>>({});
	loaded = $state(false);
	flashMsg = $state('');
	stackedResults = $state(loadStacked());
	resultsView = $state<'results' | 'messages'>('results');
	completedRuns = $state(0);
	resultTabs = $state<Record<string, ResultTab[]>>({});
	activeTabId = $state<Record<string, number | null>>({});
	private nextTabId = 1;
	private flashTimer: ReturnType<typeof setTimeout> | null = null;

	renameTab(sheetId: string, tabId: number, label: string): void {
		const trimmed = label.trim();
		if (!trimmed) return;
		this.resultTabs[sheetId] = (this.resultTabs[sheetId] ?? []).map((tab) =>
			tab.id === tabId ? { ...tab, label: trimmed } : tab
		);
	}

	togglePin(sheetId: string, tabId: number): void {
		this.resultTabs[sheetId] = (this.resultTabs[sheetId] ?? []).map((tab) =>
			tab.id === tabId ? { ...tab, pinned: !tab.pinned } : tab
		);
	}

	toggleStackedResults(): void {
		this.stackedResults = !this.stackedResults;
		try {
			localStorage.setItem(STACKED_KEY, this.stackedResults ? '1' : '0');
		} catch {
			return;
		}
	}

	/** Transient status-bar message (connection closed, etc.). */
	flash(msg: string): void {
		this.flashMsg = msg;
		if (this.flashTimer) clearTimeout(this.flashTimer);
		this.flashTimer = setTimeout(() => (this.flashMsg = ''), 4000);
	}

	get activeSheet(): Sheet | null {
		return this.sheets.find((s) => s.id === this.activeSheetId) ?? null;
	}

	get activeRun(): SheetRun | null {
		return this.activeSheetId ? (this.runs[this.activeSheetId] ?? null) : null;
	}

	async init(): Promise<void> {
		const [{ servers }, { sheets }] = await Promise.all([api.servers(), api.sheets()]);
		this.servers = servers;
		this.sheets = sheets;
		if (sheets.length === 0) {
			await this.newSheet();
		} else {
			this.activeSheetId = sheets[0].id;
		}
		this.loaded = true;
	}

	async addServer(name: string): Promise<void> {
		this.servers = (await api.addServer(name)).servers;
	}

	async removeServer(name: string): Promise<void> {
		this.servers = (await api.removeServer(name)).servers;
	}

	async newSheet(partial: Partial<Sheet> = {}): Promise<Sheet> {
		// New sheets inherit the current sheet's connection — the common case is
		// "another sheet against the same database".
		const cur = this.activeSheet;
		const { sheet } = await api.createSheet({
			server: partial.server ?? cur?.server ?? '',
			database: partial.database ?? cur?.database ?? '',
			...partial
		});
		this.sheets = [...this.sheets, sheet];
		this.activeSheetId = sheet.id;
		return sheet;
	}

	async closeSheet(id: string): Promise<void> {
		await api.updateSheet(id, { open: false }).catch(() => {});
		this.forgetSheet(id);
		if (this.sheets.length === 0) await this.newSheet();
	}

	async deleteSheet(id: string): Promise<void> {
		await api.deleteSheet(id);
		this.forgetSheet(id);
		if (this.sheets.length === 0) await this.newSheet();
	}

	async openSavedSheet(sheet: Sheet): Promise<void> {
		if (this.sheets.some((open) => open.id === sheet.id)) {
			this.activeSheetId = sheet.id;
			return;
		}
		const { sheet: reopened } = await api.updateSheet(sheet.id, { open: true });
		this.sheets = [...this.sheets, reopened];
		this.activeSheetId = reopened.id;
	}

	private forgetSheet(id: string): void {
		const index = this.sheets.findIndex((sheet) => sheet.id === id);
		this.sheets = this.sheets.filter((sheet) => sheet.id !== id);
		delete this.runs[id];
		delete this.resultTabs[id];
		delete this.activeTabId[id];
		if (this.activeSheetId === id) {
			this.activeSheetId = this.sheets[Math.max(0, index - 1)]?.id ?? null;
		}
	}

	/** Patch a sheet locally and persist it (used for rename / connection change). */
	async patchSheet(id: string, patch: Partial<Sheet>): Promise<void> {
		this.sheets = this.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s));
		await api.updateSheet(id, patch);
	}

	/** Update sheet SQL in memory only (persisted on run / debounced save). */
	setSheetSql(id: string, sql: string): void {
		this.sheets = this.sheets.map((s) => (s.id === id ? { ...s, sql } : s));
	}

	async run(sheet: Sheet, sql: string, fullSql: string): Promise<void> {
		if (!sheet.server || !sheet.database) {
			this.runs[sheet.id] = {
				running: false,
				startedAt: Date.now(),
				result: {
					ok: false,
					resultSets: [],
					messages: [],
					rowsAffected: 0,
					elapsedMs: 0,
					error: { text: 'Pick a server and database for this sheet first (top toolbar).' }
				}
			};
			return;
		}
		this.setSheetSql(sheet.id, fullSql);
		const token = Date.now();
		this.runs[sheet.id] = { running: true, startedAt: token, result: null };
		let result: RunResponse;
		try {
			result = await api.run({
				sheetId: sheet.id,
				server: sheet.server,
				database: sheet.database,
				sql,
				fullSql
			});
		} catch (e) {
			result = {
				ok: false,
				resultSets: [],
				messages: [],
				rowsAffected: 0,
				elapsedMs: 0,
				error: { text: (e as Error).message }
			};
		}
		// A cancel (or a newer run) may have replaced this run while we awaited —
		// don't clobber it with a stale response.
		const cur = this.runs[sheet.id];
		if (!cur?.running || cur.startedAt !== token) return;
		this.runs[sheet.id] = { running: false, startedAt: token, result };

		const ranAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		const kept = (this.resultTabs[sheet.id] ?? []).filter((tab) => tab.pinned);
		const fresh = result.resultSets.map((resultSet, index) => ({
			id: this.nextTabId++,
			label: `Results ${result.resultSets.length > 1 ? index + 1 : ''}`.trim(),
			title: `${sheet.name} · ${sheet.database} · ${ranAt}`,
			resultSet,
			pinned: false,
			deletedRows: new Set<number>()
		}));
		this.resultTabs[sheet.id] = [...kept, ...fresh];
		this.activeTabId[sheet.id] = fresh[0]?.id ?? kept[0]?.id ?? null;
		this.resultsView = fresh.length > 0 ? 'results' : 'messages';
		this.completedRuns++;
	}

	/** Strike out rows a DELETE removed — the grid keeps the data it already has. */
	markRowsDeleted(sheetId: string, tabId: number, rowIndexes: number[]): void {
		this.resultTabs[sheetId] = (this.resultTabs[sheetId] ?? []).map((tab) =>
			tab.id === tabId
				? { ...tab, deletedRows: new Set([...tab.deletedRows, ...rowIndexes]) }
				: tab
		);
	}

	async cancel(sheetId: string): Promise<void> {
		await api.cancel(sheetId).catch(() => {});
		const run = this.runs[sheetId];
		if (run?.running) {
			this.runs[sheetId] = {
				...run,
				running: false,
				result: {
					ok: false,
					resultSets: [],
					messages: [],
					rowsAffected: 0,
					elapsedMs: 0,
					error: { text: 'Query cancelled.' }
				}
			};
		}
	}
}

export const app = new App();
