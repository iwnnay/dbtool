import { describe, expect, it } from 'vitest';
import { isIgnored } from '$lib/server/ignore';

describe('isIgnored', () => {
	it('returns quickly for an empty ignore set', () => {
		expect(isIgnored(new Set(), 'dbo', 'Patient')).toBe(false);
	});

	it('matches qualified and bare table names case-insensitively', () => {
		expect(isIgnored(new Set(['dbo.patient']), 'DBO', 'PATIENT')).toBe(true);
		expect(isIgnored(new Set(['patient']), 'other', 'Patient')).toBe(true);
		expect(isIgnored(new Set(['dbo.patient']), 'audit', 'patient')).toBe(false);
	});
});
