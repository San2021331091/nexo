import { Injectable } from '@nestjs/common';

// The embed endpoint changes domains from time to time; override it in apps/api/.env
// (SUPEREMBED_BASE_URL) or set it to "off" to disable it. Movies and episodes both
// play through Superembed because it reports missing titles ("Not Found! This video
// doesn't exist."), so EmbedAvailabilityService can check a title before it is listed.
// VidSrc was dropped: its page is identical for every id, so availability cannot be
// checked, and vidsrc.net became a parked domain in November 2026.
const DEFAULT_SUPEREMBED_BASE_URL = 'https://multiembed.mov';

function providerBase(envName: string, fallback: string): string | null {
  const configured = (process.env[envName] ?? '').trim();
  if (['off', 'disabled', 'false', 'none'].includes(configured.toLowerCase())) return null;
  try {
    const url = new URL(configured || fallback);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch { return null; }
}

/** Builds embed player URLs from TMDB ids. Controllers never construct these. */
@Injectable()
export class PlaybackProviders {
  private get superembed() { return providerBase('SUPEREMBED_BASE_URL', DEFAULT_SUPEREMBED_BASE_URL); }

  /** Movies play through Superembed. */
  movieEmbed(tmdbId: number): string | null {
    const base = this.superembed;
    return base && Number.isInteger(tmdbId) && tmdbId > 0 ? `${base}/?video_id=${tmdbId}&tmdb=1` : null;
  }

  /** Series and drama episodes play through Superembed too. */
  episodeEmbed(tmdbId: number, season: number, episode: number): string | null {
    const base = this.superembed;
    const valid = [tmdbId, season, episode].every((value) => Number.isInteger(value) && value >= 0) && tmdbId > 0;
    return base && valid ? `${base}/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}` : null;
  }

  status() {
    const base = this.superembed;
    return { superembed: Boolean(base), superembedHost: base ? new URL(base).hostname : null };
  }
}
