import { Injectable, Logger } from '@nestjs/common';
import { PlaybackProviders } from './playback-providers';

/** What a provider adapter is asked for: a TMDB movie, or a TMDB TV episode. */
export type PlaybackRequest = { type: 'movie'; tmdbId: number } | { type: 'tv'; tmdbId: number; season: number; episode: number };
/** Title facts some adapters need to match a TMDB id to their own catalogue. */
export interface TitleFacts { title: string; originalTitle?: string; year: number | null }
export interface PlaybackServer { id: string; label: string; provider: string; url: string; kind: 'iframe' }

const MAX_SERVERS = 4;
const ARCHIVE_TTL = 24 * 60 * 60_000;
const ARCHIVE_HOSTS = new Set(['archive.org']);
// Internet Archive items carry the rights statement the uploader declared. Only
// public domain marks and Creative Commons licences are accepted as embeddable.
const OPEN_LICENSE = /^https?:\/\/creativecommons\.org\/(publicdomain\/|licenses\/)/i;

type ArchiveDoc = { identifier?: unknown; title?: unknown; year?: unknown; licenseurl?: unknown };

const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The Internet Archive item that is the same film as a TMDB title: same title,
 * release year within one year, and an open licence. Exported for tests.
 */
export function pickArchiveMatch(docs: ArchiveDoc[], facts: TitleFacts): string | null {
  if (!facts.year) return null;
  const names = new Set([facts.title, facts.originalTitle ?? ''].map(normalize).filter(Boolean));
  for (const doc of docs) {
    const identifier = typeof doc.identifier === 'string' && /^[\w.-]{1,100}$/.test(doc.identifier) ? doc.identifier : null;
    const year = Number(Array.isArray(doc.year) ? doc.year[0] : doc.year);
    const title = typeof doc.title === 'string' ? normalize(doc.title) : '';
    const license = typeof doc.licenseurl === 'string' ? doc.licenseurl : '';
    if (identifier && names.has(title) && Math.abs(year - facts.year) <= 1 && OPEN_LICENSE.test(license)) return identifier;
  }
  return null;
}

/** An HTTPS URL on one of the hosts an adapter is allowed to hand out. Exported for tests. */
export function allowedUrl(value: string | null, hosts: Set<string>): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && hosts.has(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch { return null; }
}

/**
 * Builds the numbered server list for a title. Server 1 is always the existing
 * playback provider (PlaybackProviders, unchanged); further servers come from
 * adapters for openly licensed sources. Unsupported adapters add nothing.
 */
@Injectable()
export class PlaybackSourcesService {
  private readonly logger = new Logger(PlaybackSourcesService.name);
  private readonly archiveCache = new Map<string, { expires: number; value: string | null }>();
  constructor(private readonly providers: PlaybackProviders) {}

  private get archiveEnabled() { return !['off', 'disabled', 'false', 'none'].includes((process.env.INTERNET_ARCHIVE_PROVIDER ?? '').trim().toLowerCase()); }

  async servers(request: PlaybackRequest, facts?: TitleFacts): Promise<PlaybackServer[]> {
    if (!Number.isInteger(request.tmdbId) || request.tmdbId <= 0) return [];
    const found: Omit<PlaybackServer, 'id' | 'label'>[] = [];
    const primary = request.type === 'movie' ? this.providers.movieEmbed(request.tmdbId) : this.providers.episodeEmbed(request.tmdbId, request.season, request.episode);
    if (primary) found.push({ provider: 'default', url: primary, kind: 'iframe' });
    if (request.type === 'movie' && facts && this.archiveEnabled) {
      const identifier = await this.archiveIdentifier(request.tmdbId, facts);
      const url = allowedUrl(identifier ? `https://archive.org/embed/${encodeURIComponent(identifier)}` : null, ARCHIVE_HOSTS);
      if (url) found.push({ provider: 'internet-archive', url, kind: 'iframe' });
    }
    return found.slice(0, MAX_SERVERS).map((server, index) => ({ id: `server-${index + 1}`, label: `Server ${index + 1}`, ...server }));
  }

  /** The matching openly licensed Internet Archive film, cached per TMDB id. */
  private async archiveIdentifier(tmdbId: number, facts: TitleFacts): Promise<string | null> {
    const hit = this.archiveCache.get(`movie:${tmdbId}`);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (!facts.year || !facts.title.trim()) return null;
    const quoted = facts.title.replace(/["\\]/g, ' ').trim();
    const url = new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q', `title:("${quoted}") AND mediatype:movies AND collection:(feature_films) AND year:[${facts.year - 1} TO ${facts.year + 1}]`);
    for (const field of ['identifier', 'title', 'year', 'licenseurl']) url.searchParams.append('fl[]', field);
    url.searchParams.append('sort[]', 'downloads desc');
    url.searchParams.set('rows', '10');
    url.searchParams.set('output', 'json');
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) { this.logger.warn(`Internet Archive search responded ${response.status}`); return hit?.value ?? null; }
      const body = (await response.json()) as { response?: { docs?: ArchiveDoc[] } };
      const value = pickArchiveMatch(body.response?.docs ?? [], facts);
      if (this.archiveCache.size > 5000) this.archiveCache.clear();
      this.archiveCache.set(`movie:${tmdbId}`, { expires: Date.now() + ARCHIVE_TTL, value });
      return value;
    } catch (error) {
      this.logger.warn(`Internet Archive search failed: ${error instanceof Error ? error.name : 'error'}`);
      return hit?.value ?? null;
    }
  }
}
