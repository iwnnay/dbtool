/**
 * Central client state (Svelte 5 runes). One instance for the whole app:
 * sheets + active tab, per-sheet run results, and the registered servers.
 */
import { api, type RunResponse, type Sheet } from './api';

export interface SheetRun {
	running: boolean;
	startedAt: number;
	result: RunResponse | null;
	/** Which results tab is selected (index into resultSets, or -1 = Messages). */
	activeResult: number;
}

class App {
	servers = $state<string[]>([]);
	sheets = $state<Sheet[]>([]);
	activeSheetId = $state<string | null>(null);
	runs = $state<Record<string, SheetRun>>({});
	loaded = $state(false);
	flashMsg = $state('');
	private flashTimer: ReturnType<typeof setTimeout> | null = null;

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
		const idx = this.sheets.findIndex((s) => s.id === id);
		await api.deleteSheet(id);
		this.sheets = this.sheets.filter((s) => s.id !== id);
		delete this.runs[id];
		if (this.activeSheetId === id) {
			this.activeSheetId = this.sheets[Math.max(0, idx - 1)]?.id ?? null;
		}
		if (this.sheets.length === 0) await this.newSheet();
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
				activeResult: -1,
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
		this.runs[sheet.id] = { running: true, startedAt: token, result: null, activeResult: 0 };
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
		this.runs[sheet.id] = {
			running: false,
			startedAt: token,
			result,
			activeResult: result.resultSets.length > 0 ? 0 : -1
		};
	}

	async cancel(sheetId: string): Promise<void> {
		await api.cancel(sheetId).catch(() => {});
		const run = this.runs[sheetId];
		if (run?.running) {
			this.runs[sheetId] = {
				...run,
				running: false,
				activeResult: -1,
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
