import { PlaybackProviders } from './playback-providers';

describe('PlaybackProviders', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('builds a Superembed movie URL from a TMDB id', () => {
    process.env.SUPEREMBED_BASE_URL = 'https://embed.example/';
    expect(new PlaybackProviders().movieEmbed(550)).toBe('https://embed.example/?video_id=550&tmdb=1');
  });
  it('builds a VidSrc episode URL from a TMDB id', () => {
    process.env.VIDSRC_BASE_URL = 'https://vid.example/embed';
    expect(new PlaybackProviders().episodeEmbed(1399, 2, 5)).toBe('https://vid.example/embed/tv?tmdb=1399&season=2&episode=5');
  });
  it('returns nothing for a disabled or non HTTPS provider', () => {
    process.env.SUPEREMBED_BASE_URL = 'off';
    process.env.VIDSRC_BASE_URL = 'http://vid.example/embed';
    const providers = new PlaybackProviders();
    expect(providers.movieEmbed(550)).toBeNull();
    expect(providers.episodeEmbed(1399, 1, 1)).toBeNull();
    expect(providers.status()).toMatchObject({ vidsrc: false, superembed: false });
  });
  it('rejects invalid ids', () => expect(new PlaybackProviders().movieEmbed(Number.NaN)).toBeNull());
});
