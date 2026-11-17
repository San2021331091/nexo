import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChannelRepository, MAX_CHANNELS } from './channel.repository';
import { Channel } from './channel.types';
import { YouTubeFeedService } from '../sports/youtube-feed.service';
import { PostgresService } from '../database/postgres.service';

type Health = { ok: boolean; checkedAt: number; youtube: string | null };

const FIRST_RUN_DELAY = 30_000;
const PARALLEL_CHECKS = 32;
const CHECK_TIMEOUT = 8_000;
// Pause between YouTube lookups so a run with many dead streams stays gentle.
const LOOKUP_GAP = 1_500;
// How long an instance trusts its copy of the stored results.
const STORE_TTL = 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tests a stream the way a player starts one: an HLS playlist must answer with
 * `#EXTM3U`; anything else must answer without an error status. Exported for tests.
 */
export function looksPlayable(url: string, status: number, firstBytes: string): boolean {
  if (status >= 400) return false;
  return new URL(url).pathname.toLowerCase().endsWith('.m3u8') ? firstBytes.trimStart().startsWith('#EXTM3U') : true;
}

/**
 * Checks every channel's own stream on a schedule (CHANNEL_HEALTH_INTERVAL_MINUTES,
 * default 15, "off" to disable). A dead stream is replaced in the catalog by the
 * channel's YouTube live stream when the broadcaster is live there.
 *
 * Results are stored in channel_health so every API instance (each serverless
 * function on Vercel) serves the same verdicts. Serverless deployments run
 * time-boxed passes from a cron instead of the timer; each pass starts with the
 * channels checked longest ago. Without the table, results stay in memory.
 */
@Injectable()
export class ChannelHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelHealthService.name);
  private readonly health = new Map<string, Health>();
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private lastRun: { startedAt: number; finishedAt: number | null } | null = null;
  private loadedAt = 0;
  private storeWarned = false;

  constructor(private readonly channels: ChannelRepository, private readonly youtube: YouTubeFeedService, private readonly db?: PostgresService) {}

  private storeFailed(error: unknown) {
    if (this.storeWarned) return;
    this.storeWarned = true;
    this.logger.warn(`Channel health table unavailable, keeping results in memory (run npm run db:migrate): ${error instanceof Error ? error.message : String(error)}`);
  }

  /** Reloads stored results when this instance's copy is older than STORE_TTL. */
  async sync(force = false): Promise<void> {
    if (!this.db || (!force && Date.now() - this.loadedAt < STORE_TTL)) return;
    this.loadedAt = Date.now();
    try {
      const result = await this.db.query<{ channel_id: string; ok: boolean; youtube_url: string | null; checked_at: Date }>('SELECT channel_id, ok, youtube_url, checked_at FROM channel_health');
      this.health.clear();
      for (const row of result.rows) this.health.set(row.channel_id, { ok: row.ok, youtube: row.youtube_url, checkedAt: new Date(row.checked_at).getTime() });
    } catch (error) { this.storeFailed(error); }
  }

  private async save(rows: Array<{ id: string } & Health>, keepIds: string[]): Promise<void> {
    if (!this.db) return;
    try {
      if (rows.length) await this.db.query(
        `INSERT INTO channel_health (channel_id, ok, youtube_url, checked_at)
         SELECT * FROM unnest($1::text[], $2::boolean[], $3::text[], $4::timestamptz[])
         ON CONFLICT (channel_id) DO UPDATE SET ok = EXCLUDED.ok, youtube_url = EXCLUDED.youtube_url, checked_at = EXCLUDED.checked_at`,
        [rows.map((r) => r.id), rows.map((r) => r.ok), rows.map((r) => r.youtube), rows.map((r) => new Date(r.checkedAt).toISOString())]);
      await this.db.query('DELETE FROM channel_health WHERE NOT (channel_id = ANY($1::text[]))', [keepIds]);
    } catch (error) { this.storeFailed(error); }
  }

  /** apply() with the latest stored results. */
  async applyFresh<T extends Channel>(channels: T[]): Promise<T[]> {
    await this.sync();
    return this.apply(channels);
  }

  private get intervalMinutes(): number | null {
    const configured = (process.env.CHANNEL_HEALTH_INTERVAL_MINUTES ?? '').trim().toLowerCase();
    if (['off', 'disabled', 'false', 'none', '0'].includes(configured)) return null;
    const minutes = Number(configured || 15);
    return Number.isFinite(minutes) && minutes >= 5 ? minutes : 15;
  }

  onModuleInit() {
    const minutes = this.intervalMinutes;
    if (minutes === null || process.env.NODE_ENV === 'test') return;
    const first = setTimeout(() => void this.run(), FIRST_RUN_DELAY);
    const repeat = setInterval(() => void this.run(), minutes * 60_000);
    first.unref(); repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() { for (const timer of this.timers) clearTimeout(timer); }

  /**
   * One pass over the channels. Skips if the previous pass is still going. With
   * budgetMs, no new check starts after the budget; the stalest channels go first
   * and unfinished ones wait for the next pass.
   */
  async run(options: { budgetMs?: number } = {}): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastRun = { startedAt: Date.now(), finishedAt: null };
    const deadline = options.budgetMs ? Date.now() + options.budgetMs : Infinity;
    try {
      await this.sync(true);
      const all = (await this.channels.list(MAX_CHANNELS)).filter((channel) => channel.playbackUrl);
      const age = (channel: Channel) => this.health.get(channel.id)?.checkedAt ?? 0;
      const queue = [...all].sort((a, b) => age(a) - age(b));
      const results: { channel: Channel; ok: boolean }[] = [];
      let next = 0;
      const worker = async () => {
        while (next < queue.length && Date.now() < deadline) {
          const channel = queue[next++];
          results.push({ channel, ok: await this.check(channel) });
        }
      };
      await Promise.all(Array.from({ length: PARALLEL_CHECKS }, worker));
      const saved: Array<{ id: string } & Health> = [];
      for (const { channel, ok } of results) {
        let youtube: string | null = null;
        if (!ok) {
          // Out of time: keep this channel's previous verdict for the next pass.
          if (Date.now() >= deadline) continue;
          youtube = await this.youtube.liveVideoUrl(channel.youtubeUrl, channel.name, channel.category).catch(() => null);
          await sleep(LOOKUP_GAP);
        }
        const health = { ok, checkedAt: Date.now(), youtube };
        this.health.set(channel.id, health);
        saved.push({ id: channel.id, ...health });
      }
      const ids = new Set(all.map((channel) => channel.id));
      for (const id of [...this.health.keys()]) if (!ids.has(id)) this.health.delete(id);
      await this.save(saved, [...ids]);
      this.loadedAt = Date.now();
      const summary = this.summary();
      this.logger.log(`Stream check: ${saved.length} of ${all.length} checked; ${summary.ok} ok, ${summary.offline} offline, ${summary.youtube} switched to YouTube.`);
    } catch (error) {
      this.logger.warn(`Stream check failed: ${error instanceof Error ? error.message : 'error'}`);
    } finally {
      this.running = false;
      if (this.lastRun) this.lastRun.finishedAt = Date.now();
    }
  }

  private async check(channel: Channel): Promise<boolean> {
    // YouTube and provider embeds are not raw streams; the players handle those.
    if (!channel.playbackUrl || channel.playbackKind === 'youtube' || channel.playbackKind === 'iframe') return true;
    try {
      const response = await fetch(channel.playbackUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' }, redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT) });
      // Read only the start; a direct stream would otherwise download forever.
      const reader = response.body?.getReader();
      const chunk = reader ? await reader.read() : undefined;
      await reader?.cancel().catch(() => undefined);
      const firstBytes = chunk?.value ? Buffer.from(chunk.value).subarray(0, 64).toString('utf8') : '';
      return looksPlayable(channel.playbackUrl, response.status, firstBytes);
    } catch {
      return false;
    }
  }

  /** Channels as viewers should get them: dead streams switched to YouTube where possible. */
  apply<T extends Channel>(channels: T[]): T[] {
    return channels.map((channel) => {
      const health = this.health.get(channel.id);
      if (!health) return channel;
      if (health.ok) return { ...channel, streamStatus: 'ok' as const };
      if (!health.youtube) return { ...channel, streamStatus: 'offline' as const };
      return { ...channel, playbackUrl: health.youtube, playbackKind: 'youtube' as const, streamStatus: 'youtube' as const, originalPlaybackUrl: channel.playbackUrl };
    });
  }

  summary() {
    let ok = 0, offline = 0, youtube = 0;
    for (const item of this.health.values()) { if (item.ok) ok++; else if (item.youtube) youtube++; else offline++; }
    return { checked: this.health.size, ok, offline, youtube, running: this.running, lastRun: this.lastRun ? { startedAt: new Date(this.lastRun.startedAt).toISOString(), finishedAt: this.lastRun.finishedAt ? new Date(this.lastRun.finishedAt).toISOString() : null } : null, intervalMinutes: this.intervalMinutes };
  }

  /** Per channel results for the admin panel. */
  details(): Record<string, { ok: boolean; checkedAt: string; youtube: string | null }> {
    return Object.fromEntries([...this.health].map(([id, item]) => [id, { ok: item.ok, checkedAt: new Date(item.checkedAt).toISOString(), youtube: item.youtube }]));
  }
}
