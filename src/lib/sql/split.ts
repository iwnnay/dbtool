/**
 * T-SQL text utilities: batch splitting (GO) and statement splitting (;),
 * with character offsets preserved so the editor can map a cursor position
 * to "the statement under the cursor" (Ctrl+Enter behavior).
 *
 * The lexer understands: -- line comments, nested block comments,
 * 'strings' ('' escape), [bracket identifiers] (]] escape) and
 * "quoted identifiers" ("" escape). It is shared by client and server.
 */

export interface SqlSpan {
	/** Offset of the first character of the span in the original text. */
	start: number;
	/** Offset one past the last character. */
	end: number;
	text: string;
}

type LexState = 'normal' | 'line-comment' | 'block-comment' | 'string' | 'bracket' | 'dquote';

/**
 * Walk the SQL text, invoking `onCode` for every character that is executable
 * code (not inside a comment/string/identifier). Returns nothing; the caller
 * accumulates whatever it needs.
 */
function lex(sql: string, onCode: (ch: string, i: number, state: LexState) => void): void {
	let state: LexState = 'normal';
	let depth = 0; // block comment nesting

	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		const next = sql[i + 1];

		switch (state) {
			case 'normal':
				if (ch === '-' && next === '-') {
					state = 'line-comment';
					i++;
				} else if (ch === '/' && next === '*') {
					state = 'block-comment';
					depth = 1;
					i++;
				} else if (ch === "'") {
					state = 'string';
				} else if (ch === '[') {
					state = 'bracket';
				} else if (ch === '"') {
					state = 'dquote';
				} else {
					onCode(ch, i, state);
				}
				break;
			case 'line-comment':
				if (ch === '\n') state = 'normal';
				break;
			case 'block-comment':
				if (ch === '/' && next === '*') {
					depth++;
					i++;
				} else if (ch === '*' && next === '/') {
					depth--;
					i++;
					if (depth === 0) state = 'normal';
				}
				break;
			case 'string':
				if (ch === "'") {
					if (next === "'") i++;
					else state = 'normal';
				}
				break;
			case 'bracket':
				if (ch === ']') {
					if (next === ']') i++;
					else state = 'normal';
				}
				break;
			case 'dquote':
				if (ch === '"') {
					if (next === '"') i++;
					else state = 'normal';
				}
				break;
		}
	}
}

function trimSpan(sql: string, start: number, end: number): SqlSpan | null {
	while (start < end && /\s/.test(sql[start])) start++;
	while (end > start && /\s/.test(sql[end - 1])) end--;
	if (start >= end) return null;
	return { start, end, text: sql.slice(start, end) };
}

/**
 * Split into batches on `GO` separator lines (GO must be alone on its line,
 * optionally `GO <count>` — count is ignored). Comment-only batches are kept
 * (SQL Server accepts them); empty batches are dropped.
 */
export function splitBatches(sql: string): SqlSpan[] {
	const lines = sql.split('\n');
	const batches: SqlSpan[] = [];
	let batchStart = 0;
	let offset = 0;

	for (const line of lines) {
		const lineEnd = offset + line.length;
		if (/^\s*GO(\s+\d+)?\s*(--.*)?$/i.test(line)) {
			const span = trimSpan(sql, batchStart, offset);
			if (span) batches.push(span);
			batchStart = lineEnd + 1;
		}
		offset = lineEnd + 1; // +1 for the \n
	}
	const last = trimSpan(sql, batchStart, sql.length);
	if (last) batches.push(last);
	return batches;
}

/**
 * Split a single batch into statements on top-level semicolons.
 * A batch with no semicolons is one statement.
 */
export function splitStatements(batch: string, baseOffset = 0): SqlSpan[] {
	const boundaries: number[] = [];
	lex(batch, (ch, i) => {
		if (ch === ';') boundaries.push(i);
	});

	const spans: SqlSpan[] = [];
	let start = 0;
	for (const b of boundaries) {
		const span = trimSpan(batch, start, b);
		if (span) spans.push({ start: span.start + baseOffset, end: span.end + baseOffset, text: span.text });
		start = b + 1;
	}
	const last = trimSpan(batch, start, batch.length);
	if (last) spans.push({ start: last.start + baseOffset, end: last.end + baseOffset, text: last.text });
	return spans;
}

/** All statements in the full text, batch-aware (GO then ;). */
export function allStatements(sql: string): SqlSpan[] {
	return splitBatches(sql).flatMap((b) => splitStatements(b.text, b.start));
}

/**
 * The statement containing `pos` (a cursor offset). Falls back to the nearest
 * preceding statement, then the first — so Ctrl+Enter on a blank line between
 * statements runs the one above the cursor, which is what you expect.
 */
export function statementAt(sql: string, pos: number): SqlSpan | null {
	const stmts = allStatements(sql);
	if (stmts.length === 0) return null;
	for (const s of stmts) {
		if (pos >= s.start && pos <= s.end) return s;
	}
	let prev: SqlSpan | null = null;
	for (const s of stmts) {
		if (s.end < pos) prev = s;
		else break;
	}
	return prev ?? stmts[0];
}
