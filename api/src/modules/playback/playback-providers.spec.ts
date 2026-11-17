import { PlaybackProviders } from './playback-providers';

describe('PlaybackProviders', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('builds a Superembed movie URL from a TMDB id', () => {
    process.env.SUPEREMBED_BASE_URL = 'https://embed.example/';
    expect(new PlaybackProviders().movieEmbed(550)).toBe('https://embed.example/?video_id=550&tmdb=1');
  });
  it('builds a Superembed episode URL from a TMDB id', () => {
    process.env.SUPEREMBED_BASE_URL = 'https://embed.example';
    expect(new PlaybackProviders().episodeEmbed(1399, 2, 5)).toBe('https://embed.example/?video_id=1399&tmdb=1&s=2&e=5');
  });
  it('returns nothing for a disabled or non HTTPS provider', () => {
    process.env.SUPEREMBED_BASE_URL = 'off';
    const providers = new PlaybackProviders();
    expect(providers.movieEmbed(550)).toBeNull();
    expect(providers.episodeEmbed(1399, 1, 1)).toBeNull();
    expect(providers.status()).toMatchObject({ superembed: false });
    process.env.SUPEREMBED_BASE_URL = 'http://embed.example';
    expect(new PlaybackProviders().movieEmbed(550)).toBeNull();
  });
  it('rejects invalid ids', () => expect(new PlaybackProviders().movieEmbed(Number.NaN)).toBeNull());
});
