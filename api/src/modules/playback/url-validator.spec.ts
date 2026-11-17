import { playbackKindFor, validatePlaybackUrl } from './url-validator';
describe('validatePlaybackUrl', () => {
  it('accepts any HTTPS host when no allowlist is configured', () => expect(validatePlaybackUrl('https://cdn.broadcaster.example/live/playlist.m3u8?token=a%2Fb', [])).toBe('https://cdn.broadcaster.example/live/playlist.m3u8?token=a%2Fb'));
  it('trims stray whitespace from stored URLs', () => expect(validatePlaybackUrl('  https://cdn.broadcaster.example/a.m3u8 ', [])).toBe('https://cdn.broadcaster.example/a.m3u8'));
  it('accepts HTTPS URLs for an explicitly allowed host', () => expect(validatePlaybackUrl('https://cdn.operator.example/live.m3u8', ['cdn.operator.example'])).toBe('https://cdn.operator.example/live.m3u8'));
  it('accepts official YouTube embeds even with an allowlist', () => expect(validatePlaybackUrl('https://www.youtube-nocookie.com/embed/abc123', ['cdn.operator.example'])).toContain('youtube-nocookie.com'));
  it('rejects hosts outside a configured allowlist', () => expect(validatePlaybackUrl('https://evil.example/a.m3u8', ['cdn.operator.example'])).toBeNull());
  it.each(['', '""', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://cdn.operator.example/a.m3u8', 'https://user:pass@cdn.operator.example/a.m3u8'])('rejects unsafe source %s', (url) => expect(validatePlaybackUrl(url, [])).toBeNull());
});
describe('playbackKindFor', () => {
  it('detects YouTube', () => expect(playbackKindFor('https://youtu.be/abc123')).toBe('youtube'));
  it('detects DASH manifests', () => expect(playbackKindFor('https://cdn.example/live/manifest.mpd')).toBe('dash'));
  it('defaults to HLS', () => expect(playbackKindFor('https://cdn.example/live/playlist.m3u8')).toBe('hls'));
});
