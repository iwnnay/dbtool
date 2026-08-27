import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn() }));
vi.mock('node:fs', () => ({ default: mocks }));
import { ignoreSet, loadIgnoreList, saveIgnoreList } from '$lib/server/ignore';

beforeEach(() => vi.clearAllMocks());

describe('ignore list persistence', () => {
	it('loads arrays and handles missing, malformed, or wrong-shaped files', () => {
		mocks.readFileSync.mockReturnValueOnce(JSON.stringify({ ignored: ['dbo.a'] }));
		expect(loadIgnoreList('server/name', 'db')).toEqual(['dbo.a']);
		expect(mocks.readFileSync.mock.calls[0][0]).toMatch(/server_name__db\.json$/);
		mocks.readFileSync.mockReturnValueOnce(JSON.stringify({ ignored: 'nope' }));
		expect(loadIgnoreList('s', 'd')).toEqual([]);
		mocks.readFileSync.mockImplementationOnce(() => { throw new Error('missing'); });
		expect(loadIgnoreList('s', 'd')).toEqual([]);
	});

	it('trims, deduplicates, sorts, persists, and normalizes a set', () => {
		expect(saveIgnoreList('s', 'd', [' z ', '', 'a', 'a'])).toEqual(['a', 'z']);
		expect(mocks.mkdirSync).toHaveBeenCalledWith(expect.stringMatching(/ignore$/), { recursive: true });
		expect(mocks.writeFileSync).toHaveBeenCalledWith(expect.any(String), JSON.stringify({ ignored: ['a', 'z'] }, null, '\t'));
		mocks.readFileSync.mockReturnValueOnce(JSON.stringify({ ignored: ['DBO.People'] }));
		expect(ignoreSet('s', 'd')).toEqual(new Set(['dbo.people']));
	});
});
