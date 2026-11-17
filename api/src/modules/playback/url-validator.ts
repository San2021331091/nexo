const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

const configuredHosts = () => (process.env.PLAYBACK_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);

/**
 * Accepts an operator supplied playback URL when it is HTTPS and carries no
 * credentials. PLAYBACK_ALLOWED_HOSTS is an optional restriction: when it is
 * empty every HTTPS host is accepted (the catalog database is the source of
 * truth); when it lists hosts, only those hosts and YouTube are accepted.
 */
export function validatePlaybackUrl(value: unknown, allowedHosts: string[] = configuredHosts()): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (allowedHosts.length && !YOUTUBE_HOSTS.has(host) && !allowedHosts.includes(host)) return null;
    return raw;
  } catch { return null; }
}

export function isYouTubeUrl(url: string): boolean {
  try { return YOUTUBE_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

export type PlaybackKind = 'hls' | 'dash' | 'youtube' | 'iframe';

/** Infers how a validated URL should be played when the catalog does not say. */
export function playbackKindFor(url: string): PlaybackKind {
  if (isYouTubeUrl(url)) return 'youtube';
  try { if (new URL(url).pathname.toLowerCase().endsWith('.mpd')) return 'dash'; } catch { /* fall through */ }
  return 'hls';
}
