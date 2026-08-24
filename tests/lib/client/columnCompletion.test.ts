import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { sql, MSSQL } from '@codemirror/lang-sql';
import { isInSqlComment, parseTableRefs, zoneAt } from '$lib/client/columnCompletion';

describe('isInSqlComment', () => {
	const at = (source: string) => {
		const pos = source.indexOf('|');
		const state = EditorState.create({
			doc: source.replace('|', ''),
			extensions: sql({ dialect: MSSQL })
		});
		return isInSqlComment(state, pos);
	};

	it('detects line and block comments', () => {
		expect(at('SELECT * -- pat|')).toBe(true);
		expect(at('SELECT /* pat|ient */ *')).toBe(true);
	});

	it('allows completion after a comment ends', () => {
		expect(at('SELECT * -- patient\npat|')).toBe(false);
		expect(at('SELECT /* patient */ pat|')).toBe(false);
	});

	it('does not mistake comment markers inside strings for comments', () => {
		expect(at("SELECT '-- not a comment', pat|")).toBe(false);
	});
});

describe('parseTableRefs', () => {
	it('parses plain FROM', () => {
		expect(parseTableRefs('SELECT * FROM person')).toEqual([
			{ db: undefined, schema: 'dbo', table: 'person', alias: undefined }
		]);
	});

	it('parses schema-qualified with alias, and JOINs', () => {
		const refs = parseTableRefs(
			'SELECT p.last_name FROM dbo.person p JOIN dbo.patient_diagnosis AS pd ON p.person_id = pd.person_id'
		);
		expect(refs).toEqual([
			{ db: undefined, schema: 'dbo', table: 'person', alias: 'p' },
			{ db: undefined, schema: 'dbo', table: 'patient_diagnosis', alias: 'pd' }
		]);
	});

	it('parses bracketed and three-part names', () => {
		const refs = parseTableRefs('SELECT * FROM [NGTest].[dbo].[patient documents] d');
		expect(refs).toEqual([{ db: 'NGTest', schema: 'dbo', table: 'patient documents', alias: 'd' }]);
	});

	it('does not treat keywords as aliases', () => {
		const refs = parseTableRefs('SELECT * FROM person WHERE last_name = 1');
		expect(refs[0].alias).toBeUndefined();
	});

	it('skips subqueries', () => {
		const refs = parseTableRefs('SELECT * FROM (SELECT 1 AS x) q');
		expect(refs).toEqual([]);
	});

	it('handles LEFT JOIN variants', () => {
		const refs = parseTableRefs('SELECT * FROM a LEFT OUTER JOIN dbo.b bb ON a.id = bb.id');
		expect(refs.map((r) => r.table)).toEqual(['a', 'b']);
		expect(refs[1].alias).toBe('bb');
	});

	it('captures UPDATE and INSERT INTO targets', () => {
		expect(parseTableRefs('UPDATE dbo.person SET last_name = 1')[0].table).toBe('person');
		expect(parseTableRefs('INSERT INTO dbo.person (a, b) VALUES (1, 2)')[0].table).toBe('person');
	});
});

describe('zoneAt', () => {
	const at = (sql: string) => {
		const pos = sql.indexOf('|');
		return zoneAt(sql.replace('|', ''), pos);
	};

	it('SELECT list is a column zone', () => {
		expect(at('SELECT las| FROM dbo.person')).toBe('column');
	});

	it('after FROM/JOIN is a table zone', () => {
		expect(at('SELECT * FROM per|')).toBe('table');
		expect(at('SELECT * FROM a JOIN pat|')).toBe('table');
	});

	it('WHERE / ON / GROUP BY / SET are column zones', () => {
		expect(at('SELECT * FROM t WHERE las|')).toBe('column');
		expect(at('SELECT * FROM a JOIN b ON per|')).toBe('column');
		expect(at('SELECT * FROM t GROUP BY co|')).toBe('column');
		expect(at('UPDATE t SET co|')).toBe('column');
	});

	it('UPDATE target is a table zone; INSERT column list is columns', () => {
		expect(at('UPDATE per|')).toBe('table');
		expect(at('INSERT INTO t (co|')).toBe('column');
		expect(at('INSERT INTO per|')).toBe('table');
	});

	it('empty statement start is any', () => {
		expect(at('las|')).toBe('any');
	});
});
