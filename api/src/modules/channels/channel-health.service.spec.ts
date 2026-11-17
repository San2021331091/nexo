import { ChannelHealthService, looksPlayable } from './channel-health.service';
import { Channel } from './channel.types';

describe('looksPlayable', () => {
  it('needs an HLS playlist header for .m3u8 streams', () => {
    expect(looksPlayable('https://cdn.example/live/index.m3u8', 200, '#EXTM3U\n#EXT-X-VERSION:3')).toBe(true);
    expect(looksPlayable('https://cdn.example/live/index.m3u8', 200, '<html>Not found</html>')).toBe(false);
  });
  it('treats error statuses as dead', () => {
    expect(looksPlayable('https://cdn.example/live/index.m3u8', 404, '')).toBe(false);
    expect(looksPlayable('https://cdn.example/stream.mpd', 503, '')).toBe(false);
    expect(looksPlayable('https://cdn.example/stream.mpd', 200, '<?xml')).toBe(true);
  });
});

describe('ChannelHealthService.apply', () => {
  const channel = (id: string): Channel => ({ id, slug: id, name: id, category: 'News', logoUrl: null, type: 'channel', playbackUrl: `https://cdn.example/${id}.m3u8`, playbackKind: 'hls', description: null, website: null, fbUrl: null, twUrl: null, youtubeUrl: null, isLive: true, active: true, supportsActive: false });
  const service = new ChannelHealthService({} as never, {} as never);
  const health = (service as unknown as { health: Map<string, unknown> }).health;
  health.set('up', { ok: true, checkedAt: 0, youtube: null });
  health.set('down', { ok: false, checkedAt: 0, youtube: null });
  health.set('moved', { ok: false, checkedAt: 0, youtube: 'https://www.youtube.com/watch?v=abc123DEF45' });
  const [up, down, moved, unchecked] = service.apply([channel('up'), channel('down'), channel('moved'), channel('new')]);
  it('leaves working and unchecked streams alone', () => {
    expect(up).toMatchObject({ playbackUrl: 'https://cdn.example/up.m3u8', streamStatus: 'ok' });
    expect(unchecked.streamStatus).toBeUndefined();
  });
  it('keeps a dead stream with no YouTube match, marked offline', () => expect(down).toMatchObject({ playbackUrl: 'https://cdn.example/down.m3u8', streamStatus: 'offline' }));
  it('switches a dead stream to its YouTube live stream', () => expect(moved).toMatchObject({ playbackUrl: 'https://www.youtube.com/watch?v=abc123DEF45', playbackKind: 'youtube', streamStatus: 'youtube', originalPlaybackUrl: 'https://cdn.example/moved.m3u8' }));
});
