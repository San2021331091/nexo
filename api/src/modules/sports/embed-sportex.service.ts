import { Injectable, Logger } from '@nestjs/common';

const API_URL = 'https://api.esportex.site/api/streams';
const API_HOST = 'api.esportex.site';
const CACHE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 8_000;
const SPORT_LABELS: Record<string, string> = {
  football: 'Football', basketball: 'Basketball', amfootball: 'American Football',
  baseball: 'Baseball', badminton: 'Badminton', volleyball: 'Volleyball',
  tennis: 'Tennis', race: 'Motorsport', fight: 'Combat Sports', hockey: 'Hockey',
  rugby: 'Rugby', cricket: 'Cricket', other: 'Other Sports',
};

type SportexServer = { server: string; url: string };
export type SportexEvent = {
  id: string;
  slug: string;
  name: string;
  title: string;
  type: 'video';
  category: string;
  synopsis: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  playbackUrl: string;
  playbackKind: 'iframe';
  playbackServers: { label: string; provider: 'embedsportex'; url: string }[];
  live: boolean;
  kickoff: string | null;
};

type Cache = { expires: number; items: SportexEvent[] };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function httpsUrl(value: unknown, host?: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (host && url.hostname.toLowerCase() !== host)) return null;
    return url.toString();
  } catch { return null; }
}

function eventDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}+07:00`;
  const date = Date.parse(normalized);
  return Number.isFinite(date) ? date : null;
}

/** Parses EmbedSportex's category-keyed schedule into playable, typed home-feed items. */
export function parseSportexEvents(payload: unknown, now = Date.now()): SportexEvent[] {
  if (!isRecord(payload) || payload.success !== true) return [];
  const events: SportexEvent[] = [];
  for (const [sport, value] of Object.entries(payload)) {
    const sportName = SPORT_LABELS[sport];
    if (!sportName || !Array.isArray(value)) continue;
    value.forEach((raw, index) => {
      if (!isRecord(raw)) return;
      const servers = (Array.isArray(raw.iframes) ? raw.iframes : []).flatMap((rawServer, serverIndex) => {
        if (!isRecord(rawServer)) return [];
        const url = httpsUrl(rawServer.url, API_HOST);
        if (!url) return [];
        const label = typeof rawServer.server === 'string' && rawServer.server.trim() ? rawServer.server.trim().slice(0, 50) : `Server ${serverIndex + 1}`;
        return [{ label, provider: 'embedsportex' as const, url }];
      });
      if (!servers.length) return;
      const tag = typeof raw.tag === 'string' && raw.tag.trim() ? raw.tag.trim() : 'Sports event';
      const slug = typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug.trim() : `${sport}-${index + 1}`;
      const league = typeof raw.league === 'string' ? raw.league.trim() : '';
      const kickoff = typeof raw.kickoff === 'string' ? raw.kickoff : null;
      const endTime = eventDate(raw.endTime);
      const startTime = eventDate(kickoff);
      const posterUrl = httpsUrl(raw.poster);
      const id = `sportex-${sport}-${slug}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 180);
      events.push({
        id, slug: id, name: tag, title: tag, type: 'video',
        category: [sportName, league].filter(Boolean).join(' · '),
        synopsis: [league, kickoff ? `Starts ${kickoff} WIB` : 'Live or upcoming', `Server: ${servers.map((server) => server.label).join(', ')}`].filter(Boolean).join(' · '),
        posterUrl, backdropUrl: posterUrl, playbackUrl: servers[0].url, playbackKind: 'iframe', playbackServers: servers,
        live: startTime !== null && startTime <= now && (endTime === null || endTime > now), kickoff,
      });
    });
  }
  return events.sort((a, b) => (a.kickoff ?? '').localeCompare(b.kickoff ?? '') || a.name.localeCompare(b.name));
}

@Injectable()
export class EmbedSportexService {
  private readonly logger = new Logger(EmbedSportexService.name);
  private cache: Cache | null = null;

  /** Polls no more frequently than once every 45 seconds, per EmbedSportex guidance. */
  async events(): Promise<SportexEvent[]> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.items;
    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = parseSportexEvents(await response.json());
      this.cache = { expires: Date.now() + CACHE_TTL_MS, items };
      return items;
    } catch (error) {
      this.logger.warn(`EmbedSportex request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      const items = this.cache?.items ?? [];
      this.cache = { expires: Date.now() + CACHE_TTL_MS, items };
      return items;
    }
  }
}
