import { PlaybackProviders } from './playback-providers';
import { allowedUrl, pickArchiveMatch, PlaybackSourcesService } from './playback-sources.service';

const doc = (overrides: object = {}) => ({ identifier: 'night_of_the_living_dead_dvd', title: 'Night of the Living Dead', year: 1968, licenseurl: 'http://creativecommons.org/licenses/publicdomain/', ...overrides });

describe('pickArchiveMatch', () => {
  const facts = { title: 'Night of the Living Dead', year: 1968 };
  it('accepts the same film with an open licence', () => expect(pickArchiveMatch([doc()], facts)).toBe('night_of_the_living_dead_dvd'));
  it('accepts the public domain mark and a one year difference', () => expect(pickArchiveMatch([doc({ year: '1969', licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/' })], facts)).toBe('night_of_the_living_dead_dvd'));
  it('rejects items without an open licence', () => {
    expect(pickArchiveMatch([doc({ licenseurl: undefined })], facts)).toBeNull();
    expect(pickArchiveMatch([doc({ licenseurl: 'https://example.com/all-rights-reserved' })], facts)).toBeNull();
  });
  it('rejects other titles, other years and unsafe identifiers', () => {
    expect(pickArchiveMatch([doc({ title: 'Night of the Living Dead (Remake)' })], facts)).toBeNull();
    expect(pickArchiveMatch([doc({ year: 1990 })], facts)).toBeNull();
    expect(pickArchiveMatch([doc({ identifier: '../evil' })], facts)).toBeNull();
    expect(pickArchiveMatch([doc()], { title: 'Night of the Living Dead', year: null })).toBeNull();
  });
});

describe('allowedUrl', () => {
  const hosts = new Set(['archive.org']);
  it('accepts HTTPS URLs on allowlisted hosts', () => expect(allowedUrl('https://archive.org/embed/abc', hosts)).toBe('https://archive.org/embed/abc'));
  it('rejects other hosts, HTTP and credentials', () => {
    expect(allowedUrl('https://evil.example/embed/abc', hosts)).toBeNull();
    expect(allowedUrl('https://archive.org.evil.example/x', hosts)).toBeNull();
    expect(allowedUrl('http://archive.org/embed/abc', hosts)).toBeNull();
    expect(allowedUrl('https://user:pw@archive.org/embed/abc', hosts)).toBeNull();
    expect(allowedUrl('not a url', hosts)).toBeNull();
  });
});

describe('PlaybackSourcesService', () => {
  const saved = { ...process.env };
  const realFetch = global.fetch;
  afterEach(() => { process.env = { ...saved }; global.fetch = realFetch; });

  it('numbers the existing provider as Server 1 and adds an openly licensed Archive film', async () => {
    process.env.SUPEREMBED_BASE_URL = 'https://embed.example';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ response: { docs: [doc()] } }) }) as unknown as typeof fetch;
    const servers = await new PlaybackSourcesService(new PlaybackProviders()).servers({ type: 'movie', tmdbId: 10331 }, { title: 'Night of the Living Dead', year: 1968 });
    expect(servers).toEqual([
      { id: 'server-1', label: 'Server 1', provider: 'default', url: 'https://embed.example/?video_id=10331&tmdb=1', kind: 'iframe' },
      { id: 'server-2', label: 'Server 2', provider: 'internet-archive', url: 'https://archive.org/embed/night_of_the_living_dead_dvd', kind: 'iframe' },
    ]);
  });
  it('hides unsupported providers: TV episodes get only the existing provider', async () => {
    process.env.SUPEREMBED_BASE_URL = 'https://embed.example';
    global.fetch = jest.fn() as unknown as typeof fetch;
    const servers = await new PlaybackSourcesService(new PlaybackProviders()).servers({ type: 'tv', tmdbId: 1399, season: 2, episode: 3 });
    expect(servers.map((server) => server.url)).toEqual(['https://embed.example/?video_id=1399&tmdb=1&s=2&e=3']);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('returns no servers when every provider is off or the id is invalid', async () => {
    process.env.SUPEREMBED_BASE_URL = 'off';
    process.env.INTERNET_ARCHIVE_PROVIDER = 'off';
    const service = new PlaybackSourcesService(new PlaybackProviders());
    expect(await service.servers({ type: 'movie', tmdbId: 10331 }, { title: 'Night of the Living Dead', year: 1968 })).toEqual([]);
    expect(await service.servers({ type: 'movie', tmdbId: Number.NaN })).toEqual([]);
  });
  it('keeps Server 1 when the Archive search fails', async () => {
    process.env.SUPEREMBED_BASE_URL = 'https://embed.example';
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const servers = await new PlaybackSourcesService(new PlaybackProviders()).servers({ type: 'movie', tmdbId: 10331 }, { title: 'Night of the Living Dead', year: 1968 });
    expect(servers).toHaveLength(1);
  });
});
