import { Injectable, Logger } from '@nestjs/common';
import { PostgresService } from '../database/postgres.service';
import { PlaybackProviders } from './playback-providers';

export type EmbedKind = 'movie' | 'tv';
type Item = Record<string, unknown>;

// Results are kept in embed_availability so every API instance (each serverless
// function) shares them; a title is only re-checked after its result expires.
const AVAILABLE_TTL_MS = 7 * 24 * 60 * 60_000;
const MISSING_TTL_MS = 2 * 24 * 60 * 60_000;
const CHECK_TIMEOUT_MS = 6000;
// After a burst of requests Superembed answers "Not Found" for every title for a while
// (seen in testing: early checks pass, later ones all fail, a minute later they pass).
// So checks run a few at a time, and a "missing" answer is trusted only when a title
// the provider is known to carry still passes at that moment.
const CONCURRENCY = 4;
const CANARY: Record<EmbedKind, number> = { movie: 550, tv: 1399 }; // Fight Club, Game of Thrones
const CANARY_TTL_MS = 30_000;
/** How long checking stops after the canary fails (the provider is throttling). */
const THROTTLE_PAUSE_MS = 90_000;
/** Requests per minute per instance; throttling began after about 55 in a few seconds. */
const MAX_REQUESTS_PER_MINUTE = 40;
/** Longest a listing waits for checks; titles still unchecked are left out this time. */
const LIST_BUDGET_MS = 8000;
// Superembed answers 200 either way; a missing title is a short page with this text.
const MISSING_TEXT = /doesn['’]t exist|not found!/i;
const READ_LIMIT = 16_000;
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

const key = (kind: EmbedKind, id: number) => `${kind}:${id}`;

/** Visible page text without scripts and styles, so obfuscated code cannot match. */
export function looksMissing(html: string): boolean {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return MISSING_TEXT.test(text);
}

/** TMDB items carry tmdbId and type movie/series; everything else is not checked. */
export function embedTarget(item: Item): { kind: EmbedKind; id: number } | null {
  const id = Number(item.tmdbId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (item.type === 'movie') return { kind: 'movie', id };
  if (item.type === 'series') return { kind: 'tv', id };
  return null;
}

/**
 * Checks that the embed provider actually has a TMDB title before it is listed.
 * Movies are checked with their own embed URL; series with season 1 episode 1.
 */
@Injectable()
export class EmbedAvailabilityService {
  private readonly logger = new Logger(EmbedAvailabilityService.name);
  private readonly memory = new Map<string, { available: boolean; expires: number }>();
  private readonly inflight = new Map<string, Promise<boolean | null>>();
  private tableReady: Promise<boolean> | null = null;
  private readonly canary = new Map<EmbedKind, { ok: boolean; expires: number; running?: Promise<boolean> }>();
  private pausedUntil = 0;

  private requestTimes: number[] = [];

  private get paused() { return Date.now() < this.pausedUntil; }

  /** Takes a slot in the per minute request budget; false when it is used up. */
  private takeRequestSlot(): boolean {
    const now = Date.now();
    this.requestTimes = this.requestTimes.filter((time) => now - time < 60_000);
    if (this.requestTimes.length >= MAX_REQUESTS_PER_MINUTE) return false;
    this.requestTimes.push(now);
    return true;
  }

  /** Whether the provider currently serves a title it is known to carry. */
  private async canaryOk(kind: EmbedKind): Promise<boolean> {
    const hit = this.canary.get(kind);
    if (hit?.running) return hit.running;
    if (hit && hit.expires > Date.now()) return hit.ok;
    const running = this.probe(kind, CANARY[kind]).then((result) => {
      const ok = result === true;
      this.canary.set(kind, { ok, expires: Date.now() + CANARY_TTL_MS });
      if (!ok) { this.pausedUntil = Date.now() + THROTTLE_PAUSE_MS; this.logger.warn('Embed provider is throttling or down; pausing availability checks'); }
      return ok;
    });
    this.canary.set(kind, { ok: false, expires: 0, running });
    return running;
  }

  constructor(private readonly db: PostgresService, private readonly providers: PlaybackProviders) {}

  private ensureTable(): Promise<boolean> {
    this.tableReady ??= this.db.query(`CREATE TABLE IF NOT EXISTS embed_availability (
        kind text NOT NULL, tmdb_id integer NOT NULL, available boolean NOT NULL,
        checked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (kind, tmdb_id))`)
      .then(() => true)
      .catch((error) => { this.logger.warn(`embed_availability unavailable: ${error instanceof Error ? error.message : error}`); this.tableReady = null; return false; });
    return this.tableReady;
  }

  private remember(kind: EmbedKind, id: number, available: boolean) {
    this.memory.set(key(kind, id), { available, expires: Date.now() + (available ? AVAILABLE_TTL_MS : MISSING_TTL_MS) });
    if (this.memory.size > 20_000) for (const [entry, value] of this.memory) if (value.expires <= Date.now()) this.memory.delete(entry);
  }

  private url(kind: EmbedKind, id: number) { return kind === 'movie' ? this.providers.movieEmbed(id) : this.providers.episodeEmbed(id, 1, 1); }

  /** true: playable, false: provider says missing, null: could not tell (not cached). */
  private async probe(kind: EmbedKind, id: number): Promise<boolean | null> {
    const url = this.url(kind, id);
    if (!url) return false;
    if (!this.takeRequestSlot()) return null;
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      if (response.status === 404 || response.status === 410) return false;
      if (!response.ok || !response.body) return null;
      // Only the start of the page is needed; playable pages are hundreds of KB.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let html = '';
      while (html.length < READ_LIMIT) { const { done, value } = await reader.read(); if (done) break; html += decoder.decode(value, { stream: true }); }
      void reader.cancel().catch(() => undefined);
      return !looksMissing(html);
    } catch {
      return null;
    }
  }

  private check(kind: EmbedKind, id: number): Promise<boolean | null> {
    const entry = key(kind, id);
    const running = this.inflight.get(entry);
    if (running) return running;
    const work = (this.paused ? Promise.resolve(null) : this.probe(kind, id)).then(async (first) => {
      // "Missing" counts only while the canary title still passes; otherwise the
      // provider is throttling and the answer is unknown (not stored, retried later).
      const available = first === false && !(await this.canaryOk(kind)) ? null : first;
      if (available !== null) {
        this.remember(kind, id, available);
        if (await this.ensureTable()) {
          await this.db.query(`INSERT INTO embed_availability (kind, tmdb_id, available, checked_at) VALUES ($1, $2, $3, now())
            ON CONFLICT (kind, tmdb_id) DO UPDATE SET available = EXCLUDED.available, checked_at = EXCLUDED.checked_at`, [kind, id, available]).catch(() => undefined);
        }
      }
      return available;
    }).finally(() => this.inflight.delete(entry));
    this.inflight.set(entry, work);
    return work;
  }

  /** Loads stored results that have not expired into memory. */
  private async loadStored(targets: { kind: EmbedKind; id: number }[]) {
    if (!targets.length || !(await this.ensureTable())) return;
    try {
      const result = await this.db.query<{ kind: EmbedKind; tmdb_id: number; available: boolean; checked_at: Date }>(
        `SELECT kind, tmdb_id, available, checked_at FROM embed_availability
         WHERE (kind, tmdb_id) IN (SELECT * FROM unnest($1::text[], $2::int[]))`,
        [targets.map((target) => target.kind), targets.map((target) => target.id)]);
      for (const row of result.rows) {
        const expires = new Date(row.checked_at).getTime() + (row.available ? AVAILABLE_TTL_MS : MISSING_TTL_MS);
        if (expires > Date.now()) this.memory.set(key(row.kind, row.tmdb_id), { available: row.available, expires });
      }
    } catch { /* fall back to live checks */ }
  }

  private known(kind: EmbedKind, id: number): boolean | undefined {
    const hit = this.memory.get(key(kind, id));
    return hit && hit.expires > Date.now() ? hit.available : undefined;
  }

  /** Resolves availability for many titles, checking unknown ones within the budget. */
  async resolve(targets: { kind: EmbedKind; id: number }[], budgetMs = LIST_BUDGET_MS): Promise<Map<string, boolean>> {
    const unique = [...new Map(targets.map((target) => [key(target.kind, target.id), target])).values()];
    await this.loadStored(unique.filter((target) => this.known(target.kind, target.id) === undefined));
    const pending = unique.filter((target) => this.known(target.kind, target.id) === undefined);
    if (pending.length) {
      let next = 0;
      const worker = async () => { while (next < pending.length && !this.paused) { const target = pending[next++]; await this.check(target.kind, target.id); } };
      const workers = Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
      // Checks that outlive the budget keep running and are stored for the next request.
      await Promise.race([workers, new Promise((resolve) => setTimeout(resolve, budgetMs).unref?.())]);
    }
    const result = new Map<string, boolean>();
    for (const target of unique) result.set(key(target.kind, target.id), this.known(target.kind, target.id) === true);
    return result;
  }

  /** Keeps non TMDB items and TMDB items whose embed is confirmed playable. */
  async keepPlayable<T extends Item>(items: T[], budgetMs?: number): Promise<T[]> {
    const targets = items.map(embedTarget).filter((target): target is { kind: EmbedKind; id: number } => Boolean(target));
    if (!targets.length) return items;
    const playable = await this.resolve(targets, budgetMs);
    return items.filter((item) => { const target = embedTarget(item); return !target || playable.get(key(target.kind, target.id)) === true; });
  }

  /** Single title check, used for detail pages. */
  async isPlayable(kind: EmbedKind, id: number): Promise<boolean> {
    return (await this.resolve([{ kind, id }])).get(key(kind, id)) === true;
  }
}
