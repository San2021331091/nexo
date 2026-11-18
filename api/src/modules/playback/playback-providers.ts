
import { Injectable } from '@nestjs/common';

const DEFAULT_SUPEREMBED_BASE_URL = 'https://multiembed.mov';
const DEFAULT_AUTOEMBED_BASE_URL = 'https://autoembed.to';

export type EmbedProvider = 'superembed' | 'autoembed';

export type EmbedCandidate = {
  provider: EmbedProvider;
  url: string;
};

function providerBase(envName: string, fallback: string): string | null {
  const configured = (process.env[envName] ?? '').trim();

  if (['off', 'disabled', 'false', 'none'].includes(configured.toLowerCase())) {
    return null;
  }

  try {
    const url = new URL(configured || fallback);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

@Injectable()
export class PlaybackProviders {
  private get superembed(): string | null {
    return providerBase(
      'SUPEREMBED_BASE_URL',
      DEFAULT_SUPEREMBED_BASE_URL,
    );
  }

  private get autoembed(): string | null {
    return providerBase(
      'AUTOEMBED_BASE_URL',
      DEFAULT_AUTOEMBED_BASE_URL,
    );
  }

  movieEmbed(tmdbId: number): string | null {
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return null;
    }

    const superembed = this.superembed;

    if (superembed) {
      return `${superembed}/?video_id=${tmdbId}&tmdb=1`;
    }

    const autoembed = this.autoembed;

    if (autoembed) {
      return `${autoembed}/movie/${tmdbId}`;
    }

    return null;
  }

  episodeEmbed(
    tmdbId: number,
    season: number,
    episode: number,
  ): string | null {
    const valid =
      Number.isInteger(tmdbId) &&
      Number.isInteger(season) &&
      Number.isInteger(episode) &&
      tmdbId > 0 &&
      season >= 0 &&
      episode >= 0;

    if (!valid) {
      return null;
    }

    const superembed = this.superembed;

    if (superembed) {
      return `${superembed}/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
    }

    const autoembed = this.autoembed;

    if (autoembed) {
      return `${autoembed}/tv/${tmdbId}/${season}/${episode}`;
    }

    return null;
  }

  /**
   * Returns all configured providers in priority order.
   * Superembed is primary; AutoEmbed is fallback.
   */
  embedCandidates(
    kind: 'movie' | 'tv',
    tmdbId: number,
  ): EmbedCandidate[] {
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return [];
    }

    const candidates: EmbedCandidate[] = [];

    const superembed = this.superembed;
    const autoembed = this.autoembed;

    if (superembed) {
      candidates.push({
        provider: 'superembed',
        url:
          kind === 'movie'
            ? `${superembed}/?video_id=${tmdbId}&tmdb=1`
            : `${superembed}/?video_id=${tmdbId}&tmdb=1&s=1&e=1`,
      });
    }

    if (autoembed) {
      candidates.push({
        provider: 'autoembed',
        url:
          kind === 'movie'
            ? `${autoembed}/movie/${tmdbId}`
            : `${autoembed}/tv/${tmdbId}/1/1`,
      });
    }

    return candidates;
  }

  status() {
    const superembed = this.superembed;
    const autoembed = this.autoembed;

    return {
      superembed: Boolean(superembed),
      superembedHost: superembed
        ? new URL(superembed).hostname
        : null,

      autoembed: Boolean(autoembed),
      autoembedHost: autoembed
        ? new URL(autoembed).hostname
        : null,

      primary: superembed
        ? 'superembed'
        : autoembed
          ? 'autoembed'
          : null,

      fallbackEnabled: Boolean(autoembed),
    };
  }
}
