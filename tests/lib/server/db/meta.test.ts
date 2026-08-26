import { describe, expect, it } from 'vitest';
import { formatTableContext, formatType, type ColumnInfo, type TableDetail } from '$lib/server/db/meta';

function column(type: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
	return { name: 'value', type, maxLength: 20, precision: 18, scale: 2, nullable: true,
		identity: false, computed: false, isPk: false, ...overrides };
}

describe('metadata type formatting', () => {
	it('formats sized, Unicode, numeric, temporal, max, and plain types', () => {
		expect(formatType(column('VARCHAR'))).toBe('varchar(20)');
		expect(formatType(column('varbinary', { maxLength: -1 }))).toBe('varbinary(max)');
		expect(formatType(column('nvarchar'))).toBe('nvarchar(10)');
		expect(formatType(column('nchar', { maxLength: -1 }))).toBe('nchar(max)');
		expect(formatType(column('decimal'))).toBe('decimal(18,2)');
		expect(formatType(column('numeric', { precision: 8, scale: 3 }))).toBe('numeric(8,3)');
		expect(formatType(column('datetime2'))).toBe('datetime2(2)');
		expect(formatType(column('time', { scale: 7 }))).toBe('time');
		expect(formatType(column('int'))).toBe('int');
	});
});

describe('table context formatting', () => {
	it('includes columns, indexes, relationships, flags, and the inbound-key cap', () => {
		const referencedBy = Array.from({ length: 62 }, (_, index) => ({
			name: `FK_child_${index}`, childTable: `dbo.child_${index}`, childColumns: 'parent_id', columns: 'id'
		}));
		const detail: TableDetail = {
			schema: 'dbo', name: 'parent', objectType: 'USER_TABLE', rowCount: 1234,
			columns: [
				column('int', { name: 'id', nullable: false, identity: true, isPk: true }),
				column('nvarchar', { name: 'display_name', computed: true })
			],
			indexes: [{ name: 'IX_parent_name', type: 'NONCLUSTERED', unique: true,
				primaryKey: false, keyColumns: 'display_name', includedColumns: 'id' }],
			foreignKeys: [{ name: 'FK_parent_owner', columns: 'owner_id',
				referencedTable: 'dbo.owner', referencedColumns: 'id' }],
			referencedBy
		};
		const context = formatTableContext('local', 'app', detail, 'Parent records');
		expect(context).toContain('# Table: dbo.parent');
		expect(context).toContain('Description: Parent records');
		expect(context).toContain('id int NOT NULL PRIMARY KEY IDENTITY');
		expect(context).toContain('display_name nvarchar(10) NULL COMPUTED');
		expect(context).toContain('IX_parent_name (NONCLUSTERED, UNIQUE): display_name INCLUDE (id)');
		expect(context).toContain('owner_id -> dbo.owner(id)  [FK_parent_owner]');
		expect(context).toContain('… and 2 more referencing tables');
		expect(context).not.toContain('dbo.child_60(parent_id)');
	});

	it('formats a minimal view without optional sections', () => {
		const context = formatTableContext('local', 'app', {
			schema: 'reporting', name: 'summary', objectType: 'VIEW', rowCount: null,
			columns: [], indexes: [], foreignKeys: [], referencedBy: []
		});
		expect(context).toContain('# View: reporting.summary');
		expect(context).not.toContain('Rows:');
		expect(context).not.toContain('## Indexes');
		expect(context).not.toContain('## Foreign keys');
	});
});
