import { Injectable } from '@nestjs/common';

// Embed endpoints change domains from time to time; override them in apps/api/.env
// (VIDSRC_BASE_URL / SUPEREMBED_BASE_URL) or set either to "off" to disable it.
const DEFAULT_VIDSRC_BASE_URL = 'https://vidsrc.net/embed';
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
  private get vidsrc() { return providerBase('VIDSRC_BASE_URL', DEFAULT_VIDSRC_BASE_URL); }
  private get superembed() { return providerBase('SUPEREMBED_BASE_URL', DEFAULT_SUPEREMBED_BASE_URL); }

  /** Movies play through Superembed. */
  movieEmbed(tmdbId: number): string | null {
    const base = this.superembed;
    return base && Number.isInteger(tmdbId) && tmdbId > 0 ? `${base}/?video_id=${tmdbId}&tmdb=1` : null;
  }

  /** Series and drama episodes play through VidSrc. */
  episodeEmbed(tmdbId: number, season: number, episode: number): string | null {
    const base = this.vidsrc;
    const valid = [tmdbId, season, episode].every((value) => Number.isInteger(value) && value >= 0) && tmdbId > 0;
    return base && valid ? `${base}/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}` : null;
  }

  status() {
    const host = (base: string | null) => (base ? new URL(base).hostname : null);
    return { vidsrc: Boolean(this.vidsrc), vidsrcHost: host(this.vidsrc), superembed: Boolean(this.superembed), superembedHost: host(this.superembed) };
  }
}
