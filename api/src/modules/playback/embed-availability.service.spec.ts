import { EmbedAvailabilityService, embedTarget, looksMissing } from './embed-availability.service';
import { PlaybackProviders } from './playback-providers';
import type { PostgresService } from '../database/postgres.service';

const PLAYABLE = '<html><title>Streaming...</title><body><script>window.x="Not Found! fake"</script>Fight Club 1999</body></html>';
const MISSING = '<html><title>Streaming...</title><body><h1>Not Found!</h1><p>This video doesn\'t exist.</p></body></html>';

function page(html: string, status = 200) {
  return { status, ok: status < 400, body: new Response(html).body } as unknown as Response;
}

describe('looksMissing', () => {
  it('detects the Superembed not found page', () => expect(looksMissing(MISSING)).toBe(true));
  it('ignores matching text inside scripts', () => expect(looksMissing(PLAYABLE)).toBe(false));
});

describe('embedTarget', () => {
  it('maps TMDB movies and series', () => {
    expect(embedTarget({ tmdbId: 550, type: 'movie' })).toEqual({ kind: 'movie', id: 550 });
    expect(embedTarget({ tmdbId: 1399, type: 'series' })).toEqual({ kind: 'tv', id: 1399 });
  });
  it('skips items without a TMDB id', () => expect(embedTarget({ id: 'local', type: 'movie' })).toBeNull());
});

describe('EmbedAvailabilityService', () => {
  const realFetch = global.fetch;
  let db: { query: jest.Mock };
  let service: EmbedAvailabilityService;

  beforeEach(() => {
    db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    service = new EmbedAvailabilityService(db as unknown as PostgresService, new PlaybackProviders());
  });
  afterEach(() => { global.fetch = realFetch; });

  it('keeps playable TMDB titles and local items, drops missing ones', async () => {
    const fetchMock = jest.fn((url: string) => Promise.resolve(page(url.includes('video_id=2&') ? MISSING : PLAYABLE)));
    global.fetch = fetchMock as unknown as typeof fetch;
    const items = [{ tmdbId: 1, type: 'movie' }, { tmdbId: 2, type: 'movie' }, { tmdbId: 3, type: 'series' }, { id: 'local', type: 'movie' }];
    expect(await service.keepPlayable(items)).toEqual([items[0], items[2], items[3]]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([expect.stringContaining('video_id=3&tmdb=1&s=1&e=1')]));
  });

  it('uses stored results without fetching', async () => {
    db.query.mockImplementation((sql: string) => Promise.resolve({ rows: sql.startsWith('SELECT') ? [{ kind: 'movie', tmdb_id: 7, available: false, checked_at: new Date() }] : [] }));
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await service.keepPlayable([{ tmdbId: 7, type: 'movie' }])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps titles it could not check and does not store them', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await service.keepPlayable([{ tmdbId: 9, type: 'movie' }])).toEqual([{ tmdbId: 9, type: 'movie' }]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
  });

  it('rejects a missing title only while the canary title still passes', async () => {
    const fetchMock = jest.fn((url: string) => Promise.resolve(url.includes('video_id=550&') ? page(PLAYABLE) : page('', 404)));
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await service.isPlayable('movie', 10)).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([expect.stringContaining('video_id=550&')]));
    expect(db.query.mock.calls.some(([sql, values]) => String(sql).startsWith('INSERT') && values?.[2] === false)).toBe(true);
  });

  it('treats everything as unknown while the provider is throttling', async () => {
    const fetchMock = jest.fn(() => Promise.resolve(page(MISSING)));
    global.fetch = fetchMock as unknown as typeof fetch;
    const items = [12, 13, 14, 15, 16].map((tmdbId) => ({ tmdbId, type: 'series' }));
    expect(await service.keepPlayable(items)).toEqual(items);
    // Nothing is stored as missing, and checking pauses after the canary fails.
    expect(db.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
    const calls = fetchMock.mock.calls.length;
    await service.keepPlayable([{ tmdbId: 17, type: 'series' }]);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
