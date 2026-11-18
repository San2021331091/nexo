import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PostgresService } from '../database/postgres.service';
import { parseYouTubeFeed } from '../sports/youtube-feed.service';

// Full episodes and full movies that broadcasters and distributors upload to their
// own official YouTube channels. A daily sync reads each channel's newest uploads,
// keeps the full length ones, and adds them to the youtube_library table, so the
// library grows every day. Override a group with MOVIES_FULL_YOUTUBE_CHANNELS,
// SERIES_FULL_YOUTUBE_CHANNELS or DRAMAS_FULL_YOUTUBE_CHANNELS (comma separated
// channel ids, "off" to disable). Only list channels that own what they upload.
export type LibraryGroup = 'movies' | 'series' | 'dramas';
const CHANNELS: Record<LibraryGroup, { env: string; ids: string[] }> = {
  movies: { env: 'MOVIES_FULL_YOUTUBE_CHANNELS', ids: ['UCF1JIbMUs6uqoZEY1Haw0GQ' /* Shemaroo */, 'UCEKWXRsfUHkan-D_ljU8Asw' /* Rajshri */, 'UCZrZaZM9IfX-uB-9yWf5gfQ' /* iQIYI English */] },
  series: { env: 'SERIES_FULL_YOUTUBE_CHANNELS', ids: ['UCI70JGG0hJS306Q-hGWfB7Q' /* YOUKU English */, 'UCZrZaZM9IfX-uB-9yWf5gfQ' /* iQIYI English */] },
  dramas: { env: 'DRAMAS_FULL_YOUTUBE_CHANNELS', ids: ['UC-LPIU24bQXVljUXivKEeRQ' /* StarPlus */, 'UCEeEQxm6qc_qaTE7qTV5aLQ' /* HUM TV */, 'UCe9JSDmyqNgA_l2BzGHq1Ug' /* HAR PAL GEO */, 'UCJL8FI5LLq1G_qE5Ny-Zsqw' /* TVB Mandarin Drama */, 'UCBAEVMr0li9YYF8IwZHfusw' /* MBC DRAMA */, 'UCsr6QVeLlkitleHoS0T4IxQ' /* Banglavision Drama */] },
};
export const LIBRARY_GROUPS = Object.keys(CHANNELS) as LibraryGroup[];
const DAY = 24 * 60 * 60_000;
const FIRST_RUN_DELAY = 2 * 60_000;
const READ_TTL = 10 * 60_000;
/** Older uploads read through the YouTube Data API the first time a channel is synced. */
const BACKFILL_PAGES = 4;

export function libraryChannels(group: LibraryGroup): string[] {
  const { env, ids } = CHANNELS[group];
  const configured = (process.env[env] ?? '').trim();
  if (['off', 'disabled', 'false', 'none'].includes(configured.toLowerCase())) return [];
  const list = (configured ? configured.split(',') : ids).map((id) => id.trim()).filter((id) => /^UC[\w-]{20,24}$/.test(id));
  return [...new Set(list)].slice(0, 20);
}

// Promos, teasers, clips and other short pieces that are not the full title.
const NOT_FULL = /\b(promo|teaser|trailer|highlights?|best scenes?|scenes?\s*\d|reels?|preview|recap|behind the scenes|bts|making of|coming soon|interview|ost|mv|status)\b|#shorts|\bclip|【\s*(trailer|highlight|clip|preview)/i;
const EPISODE = /\b(full\s+ep(isode)?s?\b|ep(isode)?\.?\s*-?\s*\d{1,4}\b)|第\s*\d{1,4}\s*集|\b\d{1,3}\s*&\s*\d{1,3}\s*\/\s*\d{1,3}\b|الحلقة\s*\d{1,4}|\bnatok\b|নাটক/i;
const MOVIE = /\bfull\s+(\w+\s+){0,2}(movie|film)\b|\b(chinese|korean|hindi dubbed)\s+movie\b|\bmovie\s+20\d\d\b/i;

/** Whether an upload title is a full episode (series, dramas) or a full movie. Exported for tests. */
export function isFullLength(group: LibraryGroup, raw: string): boolean {
  // NFKC turns styled letters ("𝐁𝐞𝐬𝐭 𝐒𝐜𝐞𝐧𝐞") into plain ones before matching.
  const title = raw.normalize('NFKC');
  if (!title.trim() || NOT_FULL.test(title)) return false;
  return group === 'movies' ? MOVIE.test(title) : EPISODE.test(title);
}

export type LibraryVideo = { id: string; slug: string; name: string; title: string; type: 'video'; category: string; synopsis: string; posterUrl: null; backdropUrl: string; year: number | null; publishedAt: string; playbackUrl: string; playbackKind: 'youtube' };
type Upload = { videoId: string; channelId: string; channelTitle: string; title: string; publishedAt: string };
type Row = { video_id: string; channel_title: string; title: string; published_at: Date | string };

export function libraryVideo(row: Row): LibraryVideo {
  const publishedAt = new Date(row.published_at).toISOString();
  return { id: `yt-${row.video_id}`, slug: `yt-${row.video_id}`, name: row.title, title: row.title, type: 'video', category: row.channel_title, synopsis: row.channel_title, posterUrl: null, backdropUrl: `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`, year: Number(publishedAt.slice(0, 4)) || null, publishedAt, playbackUrl: `https://www.youtube.com/watch?v=${row.video_id}`, playbackKind: 'youtube' };
}

export interface LibrarySyncResult { channels: number; seen: number; added: number; failed: number; finishedAt: string }

@Injectable()
export class YouTubeLibraryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(YouTubeLibraryService.name);
  private tableReady: Promise<boolean> | null = null;
  private running: Promise<LibrarySyncResult> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly readCache = new Map<string, { expires: number; value: LibraryVideo[] }>();
  private lastResult: LibrarySyncResult | null = null;
  constructor(private readonly db: PostgresService) {}

  onModuleInit() {
    const configured = (process.env.YOUTUBE_LIBRARY_SYNC ?? '').trim().toLowerCase();
    if (['off', 'disabled', 'false', 'none'].includes(configured) || process.env.NODE_ENV === 'test') return;
    const first = setTimeout(() => void this.sync(), FIRST_RUN_DELAY);
    const repeat = setInterval(() => void this.sync(), DAY);
    first.unref(); repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() { for (const timer of this.timers) clearTimeout(timer); }

  get status() { return this.lastResult; }

  private ensureTable(): Promise<boolean> {
    this.tableReady ??= this.db.query(`CREATE TABLE IF NOT EXISTS youtube_library (
        video_id text NOT NULL, grp text NOT NULL, channel_id text NOT NULL, channel_title text NOT NULL,
        title text NOT NULL, published_at timestamptz NOT NULL, added_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (grp, video_id));
      CREATE INDEX IF NOT EXISTS youtube_library_recent ON youtube_library (grp, published_at DESC)`)
      .then(() => true)
      .catch((error) => { this.logger.warn(`youtube_library unavailable: ${error instanceof Error ? error.message : error}`); this.tableReady = null; return false; });
    return this.tableReady;
  }

  /** The newest uploads from the channel's public feed (15 at most). */
  private async feedUploads(channelId: string): Promise<Upload[]> {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`feed ${response.status}`);
    const feed = parseYouTubeFeed(channelId, await response.text());
    return feed.items.map((item) => ({ videoId: item.id.slice(3), channelId, channelTitle: feed.title, title: item.name, publishedAt: item.publishedAt }));
  }

  /** Older uploads through the Data API uploads playlist, when YOUTUBE_API_KEY is set. */
  private async apiUploads(channelId: string, pages: number): Promise<Upload[]> {
    const key = process.env.YOUTUBE_API_KEY?.trim();
    if (!key) return [];
    const found: Upload[] = [];
    let pageToken = '';
    for (let page = 0; page < pages; page++) {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      for (const [name, value] of Object.entries({ part: 'snippet', maxResults: '50', playlistId: `UU${channelId.slice(2)}`, key, pageToken })) if (value) url.searchParams.set(name, value);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`YouTube API ${response.status}`);
      const body = (await response.json()) as { nextPageToken?: string; items?: { snippet?: { title?: string; publishedAt?: string; channelTitle?: string; resourceId?: { videoId?: string } } }[] };
      for (const item of body.items ?? []) {
        const snippet = item.snippet;
        const videoId = snippet?.resourceId?.videoId ?? '';
        if (/^[\w-]{6,20}$/.test(videoId) && snippet?.title && snippet.publishedAt) found.push({ videoId, channelId, channelTitle: snippet.channelTitle ?? '', title: snippet.title, publishedAt: snippet.publishedAt });
      }
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return found;
  }

  /** One pass over every configured channel. A pass already running is shared. */
  sync(): Promise<LibrarySyncResult> {
    this.running ??= this.syncOnce().finally(() => { this.running = null; });
    return this.running;
  }

  private async syncOnce(): Promise<LibrarySyncResult> {
    const result: LibrarySyncResult = { channels: 0, seen: 0, added: 0, failed: 0, finishedAt: '' };
    if (!(await this.ensureTable())) { result.finishedAt = new Date().toISOString(); return result; }
    const known = new Set((await this.db.query<{ channel_id: string; grp: string }>('SELECT DISTINCT channel_id, grp FROM youtube_library')).rows.map((row) => `${row.grp}:${row.channel_id}`));
    const uploadsCache = new Map<string, Promise<Upload[]>>();
    for (const group of LIBRARY_GROUPS) {
      for (const channelId of libraryChannels(group)) {
        result.channels++;
        try {
          // A channel shared by two groups is downloaded once.
          const backfill = !known.has(`${group}:${channelId}`);
          const cacheKey = `${channelId}:${backfill}`;
          if (!uploadsCache.has(cacheKey)) uploadsCache.set(cacheKey, Promise.all([this.feedUploads(channelId), backfill ? this.apiUploads(channelId, BACKFILL_PAGES).catch(() => []) : Promise.resolve([])]).then(([feed, older]) => [...feed, ...older]));
          const uploads = await uploadsCache.get(cacheKey)!;
          const channelTitle = uploads.find((upload) => upload.channelTitle)?.channelTitle ?? '';
          const full = uploads.filter((upload) => isFullLength(group, upload.title));
          result.seen += uploads.length;
          for (const upload of full) {
            const inserted = await this.db.query(
              `INSERT INTO youtube_library (video_id, grp, channel_id, channel_title, title, published_at) VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (grp, video_id) DO UPDATE SET title = EXCLUDED.title, channel_title = EXCLUDED.channel_title RETURNING (xmax = 0) AS inserted`,
              [upload.videoId, group, channelId, upload.channelTitle || channelTitle, upload.title, upload.publishedAt]);
            if (inserted.rows[0]?.inserted) result.added++;
          }
        } catch (error) {
          result.failed++;
          this.logger.warn(`YouTube library ${group} ${channelId} failed: ${error instanceof Error ? error.message : 'error'}`);
        }
      }
    }
    this.readCache.clear();
    result.finishedAt = new Date().toISOString();
    this.lastResult = result;
    this.logger.log(`YouTube library sync: ${result.added} added from ${result.channels} channels (${result.failed} failed)`);
    return result;
  }

  /** The newest full episodes or movies stored for a group. Empty when the table is unavailable. */
  async latest(group: LibraryGroup, limit = 30): Promise<LibraryVideo[]> {
    const cacheKey = `${group}:${limit}`;
    const hit = this.readCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (!(await this.ensureTable())) return hit?.value ?? [];
    const channels = libraryChannels(group);
    if (!channels.length) return [];
    try {
      const result = await this.db.query<Row>('SELECT video_id, channel_title, title, published_at FROM youtube_library WHERE grp = $1 AND channel_id = ANY($2) ORDER BY published_at DESC LIMIT $3', [group, channels, Math.min(Math.max(limit, 1), 100)]);
      const value = result.rows.map(libraryVideo);
      this.readCache.set(cacheKey, { expires: Date.now() + READ_TTL, value });
      return value;
    } catch (error) {
      this.logger.warn(`YouTube library read failed: ${error instanceof Error ? error.message : 'error'}`);
      return hit?.value ?? [];
    }
  }
}
