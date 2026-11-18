import { Injectable, Logger } from '@nestjs/common';

// Official sports channels whose public uploads feed powers the Sports rails.
// Override with SPORTS_YOUTUBE_CHANNELS (comma separated channel ids, "off" to disable).
const DEFAULT_CHANNELS = ['UCpcTrCXblq78GZrTUTLWeBw' /* FIFA */, 'UCt2JXOLNxqry7B_4rRZME3Q' /* ICC */, 'UCG5qGWdu8nIRZqJ_GgDwQ-w' /* Premier League */, 'UCWJ2lWNubArHWmf3FIHbfcQ' /* NBA */, 'UC6c1z7bA__85CIWZ_jpCK-Q' /* ESPN FC */];
// Official studio and streaming channels whose Shorts power the Reels rails on the
// Movies, Web Series and Dramas tabs. Override per tab with MOVIES_YOUTUBE_CHANNELS,
// SERIES_YOUTUBE_CHANNELS or DRAMAS_YOUTUBE_CHANNELS (comma separated ids, "off" to disable).
export type ReelsGroup = 'movies' | 'series' | 'dramas';
const REELS_CHANNELS: Record<ReelsGroup, { env: string; ids: string[] }> = {
  movies: { env: 'MOVIES_YOUTUBE_CHANNELS', ids: ['UCjmJDM5pRKbUlVIzDYYWb6g' /* Warner Bros. */, 'UCvC4D8onUfXzvjTOM-dBfEA' /* Marvel Entertainment */, 'UCq0OueAsdxH6b8nyAspwViw' /* Universal Pictures */, 'UCz97F7dMxBNOfGYu3rx8aCw' /* Sony Pictures */, 'UCQJWtTnAHhEG5w4uN0udnUQ' /* Prime Video */] },
  series: { env: 'SERIES_YOUTUBE_CHANNELS', ids: ['UCWOA1ZGywLbqmigxE4Qlvuw' /* Netflix */, 'UCIrgJInjLS2BhlHOMDW7v0g' /* Disney Plus */, 'UCZSNzBgFub_WWil6TOTYwAg' /* Netflix India */, 'UC4zWG9LccdWGUlF77LZ8toA' /* Prime Video India */, 'UC0PTktRYpZXb6On0_zFKWIg' /* JioHotstar */] },
  dramas: { env: 'DRAMAS_YOUTUBE_CHANNELS', ids: ['UCpiCK8c6PBktcxq7Az_t4RQ' /* Netflix K-Content */, 'UCr0_xzS43ijsp0ab4XUGjkQ' /* Hoichoi */, 'UCXOgAl4w-FQero1ERbGHpXQ' /* ZEE5 */, 'UCAqlxq4Bs9PjI86M9lM18TA' /* KOCOWA TV */, 'UCe9JSDmyqNgA_l2BzGHq1Ug' /* HAR PAL GEO */] },
};
const TTL = 15 * 60_000;

function configuredIds(envName: string, fallback: string[]): string[] {
  const configured = (process.env[envName] ?? '').trim();
  if (['off', 'disabled', 'false', 'none'].includes(configured.toLowerCase())) return [];
  const ids = (configured ? configured.split(',') : fallback).map((id) => id.trim()).filter((id) => /^UC[\w-]{20,24}$/.test(id));
  return [...new Set(ids)].slice(0, 12);
}

// A type alias (not an interface) so items stay assignable to generic catalog records.
export type SportsVideo = { id: string; slug: string; name: string; title: string; type: 'video' | 'short'; category: string; synopsis: string; posterUrl: string | null; backdropUrl: string; year: number | null; publishedAt: string; playbackUrl: string; playbackKind: 'youtube' };
/** `items` are full length videos; `shorts` are vertical YouTube Shorts. */
export interface SportsFeed { channelId: string; title: string; items: SportsVideo[]; shorts: SportsVideo[] }

const decode = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => { const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml); return match ? decode(match[1].trim()) : ''; };

/** Parses a YouTube channel Atom feed into playable items. Exported for tests. */
export function parseYouTubeFeed(channelId: string, xml: string): SportsFeed {
  const [head, ...entries] = xml.split('<entry>');
  const title = tag(head, 'title') || 'Sports';
  const videos = entries.flatMap((entry): SportsVideo[] => {
    const videoId = tag(entry, 'yt:videoId');
    if (!/^[\w-]{6,20}$/.test(videoId)) return [];
    const short = entry.includes('/shorts/');
    const name = tag(entry, 'title');
    const publishedAt = tag(entry, 'published');
    const parsedYear = Number(publishedAt.slice(0, 4));
    const year = Number.isInteger(parsedYear) && parsedYear > 2000 ? parsedYear : null;
    const backdropUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    return [short
      // oar2 is YouTube's vertical (9:16) thumbnail for Shorts.
      ? { id: `yt-short-${videoId}`, slug: `yt-short-${videoId}`, name, title: name, type: 'short', category: title, synopsis: '', posterUrl: `https://i.ytimg.com/vi/${videoId}/oar2.jpg`, backdropUrl, year, publishedAt, playbackUrl: `https://www.youtube.com/shorts/${videoId}`, playbackKind: 'youtube' }
      : { id: `yt-${videoId}`, slug: `yt-${videoId}`, name, title: name, type: 'video', category: title, synopsis: '', posterUrl: null, backdropUrl, year, publishedAt, playbackUrl: `https://www.youtube.com/watch?v=${videoId}`, playbackKind: 'youtube' }];
  });
  return { channelId, title, items: videos.filter((video) => video.type === 'video'), shorts: videos.filter((video) => video.type === 'short') };
}

const LIVE_TTL = 5 * 60_000;
const NO_MATCH_TTL = 6 * 60 * 60_000;
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];

/**
 * Reads a channel's `youtubeurl` value. A direct video link is returned as `video`;
 * a channel link (`/@handle`, `/channel/UC…`, `/c/name`, `/user/name`) is returned
 * as the `channel` path whose live stream has to be looked up. Exported for tests.
 */
export function parseYouTubeLink(value: unknown): { video: string } | { channel: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const id = (candidate: string | null | undefined) => (candidate && /^[\w-]{6,20}$/.test(candidate) ? candidate : null);
  if (host === 'youtu.be') { const video = id(url.pathname.split('/')[1]); return video ? { video } : null; }
  if (!YOUTUBE_HOSTS.includes(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') { const video = id(url.searchParams.get('v')); return video ? { video } : null; }
  if (['live', 'embed', 'shorts'].includes(parts[0])) { const video = id(parts[1]); return video ? { video } : null; }
  if (/^@[\w.-]{2,60}$/.test(parts[0] ?? '')) return { channel: parts[0] };
  if (['channel', 'c', 'user'].includes(parts[0]) && /^[\w.-]{2,60}$/.test(parts[1] ?? '')) return { channel: `${parts[0]}/${parts[1]}` };
  return null;
}

// Words that differ between a channel's name here and on YouTube ("Somoy TV HD" vs "SOMOY TV").
const NAME_NOISE = new Set(['tv', 'television', 'hd', 'sd', 'fhd', 'uhd', '4k', 'live', 'official', 'channel']);
// Ignored only in our own channel names ("NDTV English" is "NDTV" on YouTube). Kept in
// YouTube titles, so "iNEWS" never matches the different broadcaster "iNews Telugu".
// "news" is never ignored, so "ATN Bangla" and "ATN News" stay different broadcasters.
const LANGUAGE_WORDS = new Set(['english', 'bangla', 'bengali', 'hindi', 'urdu', 'arabic', 'tamil', 'telugu']);

/** A channel name reduced for comparison: lowercase letters and digits, noise words removed. Exported for tests. */
export function channelNameKey(name: string, ignoreLanguage = false): string {
  const words = name.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = words.filter((word) => !NAME_NOISE.has(word) && !(ignoreLanguage && LANGUAGE_WORDS.has(word)));
  return (kept.length ? kept : words).join('');
}

/** Whether a YouTube channel title is the same broadcaster as one of our channels. Exported for tests. */
export function sameBroadcaster(ourName: string, youtubeTitle: string): boolean {
  const ours = channelNameKey(ourName, true);
  // Short names ("Red", "Ten") belong to broadcasters all over the world; numbered ones ("Channel 24") are fine.
  const distinctive = ours.length >= 4 || /\d/.test(ours);
  return distinctive && ours === channelNameKey(youtubeTitle);
}

// `verified` is null when the source cannot tell (the Data API does not report badges).
const GENERIC_CATEGORIES = new Set(['movies', 'sports', 'news', 'kids', 'music', 'entertainment', 'live tv', 'religious', 'documentary', 'general']);

type LiveCandidate = { videoId: string; channelTitle: string; verified: boolean | null };

/** Live videos listed in a YouTube search results page. Exported for tests. */
export function parseLiveSearch(html: string): LiveCandidate[] {
  const json = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html)?.[1];
  if (!json) return [];
  let data: unknown;
  try { data = JSON.parse(json); } catch { return []; }
  const found: LiveCandidate[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || found.length >= 10) return;
    const video = (node as { videoRenderer?: Record<string, unknown> }).videoRenderer;
    if (video) {
      const videoId = typeof video.videoId === 'string' && /^[\w-]{6,20}$/.test(video.videoId) ? video.videoId : null;
      const channelTitle = String((video.ownerText as { runs?: { text?: string }[] } | undefined)?.runs?.[0]?.text ?? '');
      const live = JSON.stringify(video.badges ?? []).includes('LIVE') || JSON.stringify(video.thumbnailOverlays ?? []).includes('"LIVE"');
      if (videoId && channelTitle && live) found.push({ videoId, channelTitle, verified: JSON.stringify(video.ownerBadges ?? []).includes('VERIFIED') });
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(data);
  return found;
}

/** The broadcast a channel's /live page is showing, or null when it is not live now. Exported for tests. */
export function parseLivePage(html: string): { videoId: string; title: string } | null {
  if (!html.includes('"isLiveNow":true')) return null;
  const videoId = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{6,20})"/.exec(html)?.[1];
  if (!videoId) return null;
  const title = decode(/<meta name="title" content="([^"]*)"/.exec(html)?.[1] ?? '').trim();
  return { videoId, title: title || 'Live now' };
}

@Injectable()
export class YouTubeFeedService {
  private readonly logger = new Logger(YouTubeFeedService.name);
  private readonly liveCache = new Map<string, { expires: number; value: string | null }>();

  /**
   * A live stream to play for a channel whose own stream fails. Uses the channel's
   * `youtubeurl` when it has one; otherwise searches YouTube live streams for the
   * channel's name and accepts only a stream from a same-named broadcaster.
   */
  async liveVideoUrl(link: unknown, name: string, category = ''): Promise<string | null> {
    return parseYouTubeLink(link) ? this.linkedLive(link) : this.searchLive(name, category);
  }

  private async searchLive(name: string, category: string): Promise<string | null> {
    const key = channelNameKey(name, true);
    if (key.length < 2) return null;
    const cacheKey = `search:${key}:${category.toLowerCase()}`;
    const hit = this.liveCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;
    let value: string | null = null;
    try {
      // A country category narrows the search to that country's broadcaster ("Red TV Serbia").
      const country = category && !GENERIC_CATEGORIES.has(category.toLowerCase()) ? category : '';
      const candidates = await this.liveCandidates(country ? `${name} ${country}` : name);
      // Only the broadcaster's verified channel: same-named unverified channels are
      // restreams or unrelated broadcasters ("Desh TV LIVE", "RED TV" in Telugu).
      const match = candidates.find((item) => item.verified !== false && sameBroadcaster(name, item.channelTitle));
      if (match) value = `https://www.youtube.com/watch?v=${match.videoId}`;
    } catch (error) {
      this.logger.warn(`YouTube live search "${name}" failed: ${error instanceof Error ? error.name : 'error'}`);
      return hit?.value ?? null;
    }
    if (this.liveCache.size > 500) this.liveCache.clear();
    // "Not on YouTube" rarely changes, so remember it longer and search less.
    this.liveCache.set(cacheKey, { expires: Date.now() + (value ? LIVE_TTL : NO_MATCH_TTL), value });
    return value;
  }

  /** Live videos for a search: the YouTube Data API when YOUTUBE_API_KEY is set, the search page otherwise. */
  private async liveCandidates(name: string): Promise<LiveCandidate[]> {
    const apiKey = process.env.YOUTUBE_API_KEY?.trim();
    if (apiKey) {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      for (const [param, value] of Object.entries({ part: 'snippet', type: 'video', eventType: 'live', maxResults: '10', q: name, key: apiKey })) url.searchParams.set(param, value);
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`YouTube API ${response.status}`);
      const body = (await response.json()) as { items?: { id?: { videoId?: string }; snippet?: { channelTitle?: string } }[] };
      return (body.items ?? []).flatMap((item) => (item.id?.videoId && item.snippet?.channelTitle ? [{ videoId: item.id.videoId, channelTitle: item.snippet.channelTitle, verified: null }] : []));
    }
    // sp=EgJAAQ== is YouTube's "Live" search filter.
    const response = await fetch(`https://www.youtube.com/results?sp=EgJAAQ%253D%253D&search_query=${encodeURIComponent(`${name} live`)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`YouTube search ${response.status}`);
    return parseLiveSearch(await response.text());
  }

  /** The video a `youtubeurl` points at, or the stream its channel page is broadcasting now. */
  private async linkedLive(link: unknown): Promise<string | null> {
    const parsed = parseYouTubeLink(link);
    if (!parsed) return null;
    if ('video' in parsed) return `https://www.youtube.com/watch?v=${parsed.video}`;
    const hit = this.liveCache.get(parsed.channel);
    if (hit && hit.expires > Date.now()) return hit.value;
    let value: string | null = null;
    try {
      // A channel's /live page is its current broadcast when one is running.
      const response = await fetch(`https://www.youtube.com/${parsed.channel}/live`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
      const html = response.ok ? await response.text() : '';
      const video = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{6,20})"/.exec(html)?.[1];
      if (video && html.includes('"isLiveNow":true')) value = `https://www.youtube.com/watch?v=${video}`;
    } catch (error) {
      this.logger.warn(`YouTube live lookup ${parsed.channel} failed: ${error instanceof Error ? error.name : 'error'}`);
      return hit?.value ?? null;
    }
    if (this.liveCache.size > 500) this.liveCache.clear();
    this.liveCache.set(parsed.channel, { expires: Date.now() + LIVE_TTL, value });
    return value;
  }

  private readonly cache = new Map<string, { expires: number; value: SportsFeed }>();

  get channelIds(): string[] { return configuredIds('SPORTS_YOUTUBE_CHANNELS', DEFAULT_CHANNELS); }

  /** Newest Shorts from the official channels behind a Movies, Web Series or Dramas tab. */
  async reels(group: ReelsGroup, limit = 30): Promise<SportsVideo[]> {
    const { env, ids } = REELS_CHANNELS[group];
    const feeds = await Promise.all(configuredIds(env, ids).map((id) => this.feed(id)));
    return feeds.flatMap((feed) => feed?.shorts ?? []).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  }

  private async feed(channelId: string): Promise<SportsFeed | null> {
    const hit = this.cache.get(channelId);
    if (hit && hit.expires > Date.now()) return hit.value;
    try {
      const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) { this.logger.warn(`YouTube feed ${channelId} responded ${response.status}`); return hit?.value ?? null; }
      const value = parseYouTubeFeed(channelId, await response.text());
      this.cache.set(channelId, { expires: Date.now() + TTL, value });
      return value;
    } catch (error) {
      this.logger.warn(`YouTube feed ${channelId} failed: ${error instanceof Error ? error.name : 'error'}`);
      return hit?.value ?? null;
    }
  }

  private async allFeeds(): Promise<SportsFeed[]> {
    const results = await Promise.all(this.channelIds.map((id) => this.feed(id)));
    return results.filter((value): value is SportsFeed => Boolean(value));
  }

  /** One feed per configured channel with full length videos, in configured order; failed feeds are skipped. */
  async feeds(): Promise<SportsFeed[]> {
    return (await this.allFeeds()).filter((feed) => feed.items.length);
  }

  /** Newest Shorts across every configured channel. */
  async shorts(limit = 30): Promise<SportsVideo[]> {
    return (await this.allFeeds()).flatMap((feed) => feed.shorts).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  }

  private readonly liveNowCache = new Map<string, { expires: number; value: SportsVideo | null }>();

  /** The official sports channel's current live broadcast, cached for a few minutes. */
  private async channelLive(channelId: string, channelTitle: string): Promise<SportsVideo | null> {
    const hit = this.liveNowCache.get(channelId);
    if (hit && hit.expires > Date.now()) return hit.value;
    let value: SportsVideo | null = null;
    try {
      const response = await fetch(`https://www.youtube.com/channel/${channelId}/live`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
      const live = response.ok ? parseLivePage(await response.text()) : null;
      if (live) value = { id: `yt-live-${live.videoId}`, slug: `yt-live-${live.videoId}`, name: live.title, title: live.title, type: 'video', category: channelTitle, synopsis: 'Live now', posterUrl: null, backdropUrl: `https://i.ytimg.com/vi/${live.videoId}/hqdefault_live.jpg`, year: null, publishedAt: new Date().toISOString(), playbackUrl: `https://www.youtube.com/watch?v=${live.videoId}`, playbackKind: 'youtube' };
    } catch (error) {
      this.logger.warn(`YouTube live check ${channelId} failed: ${error instanceof Error ? error.name : 'error'}`);
      return hit?.value ?? null;
    }
    this.liveNowCache.set(channelId, { expires: Date.now() + LIVE_TTL, value });
    return value;
  }

  /** Broadcasts that the official sports channels are streaming right now. */
  async liveNow(): Promise<SportsVideo[]> {
    const feeds = new Map((await this.allFeeds()).map((feed) => [feed.channelId, feed.title]));
    const live = await Promise.all(this.channelIds.map((id) => this.channelLive(id, feeds.get(id) ?? 'Sports')));
    return live.filter((value): value is SportsVideo => Boolean(value));
  }

  /** Newest videos across every configured channel. */
  async latest(limit = 12): Promise<SportsVideo[]> {
    return (await this.feeds()).flatMap((feed) => feed.items).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  }
}
