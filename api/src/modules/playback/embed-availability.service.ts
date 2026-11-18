
import { Injectable, Logger } from '@nestjs/common';
import { PostgresService } from '../database/postgres.service';
import { PlaybackProviders } from './playback-providers';

export type EmbedKind = 'movie' | 'tv';
type ProviderName = 'superembed' | 'autoembed';
type Item = Record<string, unknown>;

// Results are kept in embed_availability so every API instance (each serverless
// function) shares them; a title is only re-checked after its result expires.
const AVAILABLE_TTL_MS = 7 * 24 * 60 * 60_000;
const MISSING_TTL_MS = 2 * 24 * 60 * 60_000;
const CHECK_TIMEOUT_MS = 6000;

// Checks run a few at a time, and a "missing" answer is trusted only when
// a title the provider is known to carry still passes at that moment.
const CONCURRENCY = 4;
const CANARY: Record<EmbedKind, number> = {
  movie: 550,
  tv: 1399,
};
const CANARY_TTL_MS = 30_000;

/** How long checking stops after the canary fails. */
const THROTTLE_PAUSE_MS = 90_000;

/** Requests per minute per instance. */
const MAX_REQUESTS_PER_MINUTE = 40;

/** Longest a listing waits for checks. */
const LIST_BUDGET_MS = 8000;

// Superembed answers 200 either way; a missing title is a short page with this text.
const MISSING_TEXT = /doesn['’]t exist|not found!/i;
const READ_LIMIT = 16_000;

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

const key = (kind: EmbedKind, id: number) => `${kind}:${id}`;

/** Visible page text without scripts and styles, so obfuscated code cannot match. */
export function looksMissing(html: string): boolean {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  return MISSING_TEXT.test(text);
}

/** TMDB items carry tmdbId and type movie/series; everything else is not checked. */
export function embedTarget(
  item: Item,
): { kind: EmbedKind; id: number } | null {
  const id = Number(item.tmdbId);

  if (!Number.isInteger(id) || id <= 0) return null;

  if (item.type === 'movie') return { kind: 'movie', id };
  if (item.type === 'series') return { kind: 'tv', id };

  return null;
}

@Injectable()
export class EmbedAvailabilityService {
  private readonly logger = new Logger(EmbedAvailabilityService.name);

  private readonly memory = new Map<
    string,
    { available: boolean; expires: number }
  >();

  private readonly inflight = new Map<
    string,
    Promise<boolean | null>
  >();

  private tableReady: Promise<boolean> | null = null;

  // Canary state is independent for each provider and content type.
  private readonly canary = new Map<
    string,
    {
      ok: boolean;
      expires: number;
      running?: Promise<boolean>;
    }
  >();

  // Each provider has its own throttle pause.
  private readonly pausedUntil = new Map<ProviderName, number>();

  private requestTimes: number[] = [];

  constructor(
    private readonly db: PostgresService,
    private readonly providers: PlaybackProviders,
  ) {}

  private isPaused(provider: ProviderName): boolean {
    return Date.now() < (this.pausedUntil.get(provider) ?? 0);
  }

  /** Takes a slot in the per-minute request budget. */
  private takeRequestSlot(): boolean {
    const now = Date.now();

    this.requestTimes = this.requestTimes.filter(
      (time) => now - time < 60_000,
    );

    if (this.requestTimes.length >= MAX_REQUESTS_PER_MINUTE) {
      return false;
    }

    this.requestTimes.push(now);
    return true;
  }

  /** Whether a provider currently serves a title it is known to carry. */
  private async canaryOk(
    kind: EmbedKind,
    provider: ProviderName,
  ): Promise<boolean> {
    const cacheKey = `${provider}:${kind}`;
    const hit = this.canary.get(cacheKey);

    if (hit?.running) return hit.running;
    if (hit && hit.expires > Date.now()) return hit.ok;

    const candidate = this.providers
      .embedCandidates(kind, CANARY[kind])
      .find((item) => item.provider === provider);

    if (!candidate) return false;

    // IMPORTANT: Canary uses probeUrl directly.
    // It must not call probe(), otherwise fallback can cause recursion.
    const running = this.probeUrl(candidate.url)
      .then((result) => {
        const ok = result === true;

        this.canary.set(cacheKey, {
          ok,
          expires: Date.now() + CANARY_TTL_MS,
        });

        if (!ok) {
          this.pausedUntil.set(
            provider,
            Date.now() + THROTTLE_PAUSE_MS,
          );

          this.logger.warn(
            `${provider} is throttling or unavailable; pausing its availability checks`,
          );
        } else {
          this.pausedUntil.delete(provider);
        }

        return ok;
      })
      .catch((error) => {
        this.pausedUntil.set(
          provider,
          Date.now() + THROTTLE_PAUSE_MS,
        );

        this.logger.warn(
          `${provider} canary failed: ${
            error instanceof Error ? error.message : error
          }`,
        );

        return false;
      });

    this.canary.set(cacheKey, {
      ok: false,
      expires: 0,
      running,
    });

    return running;
  }

  /** Creates the shared PostgreSQL availability table. */
  private ensureTable(): Promise<boolean> {
    this.tableReady ??= this.db
      .query(`
        CREATE TABLE IF NOT EXISTS embed_availability (
          kind text NOT NULL,
          tmdb_id integer NOT NULL,
          available boolean NOT NULL,
          checked_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (kind, tmdb_id)
        )
      `)
      .then(() => true)
      .catch((error) => {
        this.logger.warn(
          `embed_availability unavailable: ${
            error instanceof Error ? error.message : error
          }`,
        );

        this.tableReady = null;
        return false;
      });

    return this.tableReady;
  }

  /** Saves an availability result in memory. */
  private remember(
    kind: EmbedKind,
    id: number,
    available: boolean,
  ): void {
    this.memory.set(key(kind, id), {
      available,
      expires:
        Date.now() +
        (available ? AVAILABLE_TTL_MS : MISSING_TTL_MS),
    });

    if (this.memory.size > 20_000) {
      for (const [entry, value] of this.memory) {
        if (value.expires <= Date.now()) {
          this.memory.delete(entry);
        }
      }
    }
  }

  /** Returns URLs in Superembed-first, AutoEmbed-second order. */
  private urls(kind: EmbedKind, id: number) {
    return this.providers.embedCandidates(kind, id);
  }

  /**
   * Performs one raw provider request.
   *
   * true  = title exists
   * false = provider says title is missing
   * null  = unable to determine
   */
  private async probeUrl(url: string): Promise<boolean | null> {
    if (!this.takeRequestSlot()) return null;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });

      if (response.status === 404 || response.status === 410) {
        return false;
      }

      if (!response.ok || !response.body) {
        this.logger.warn(
          `Embed check HTTP ${response.status} from ${
            new URL(response.url || url).host
          }`,
        );

        return null;
      }

      // Only the beginning of the page is needed.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let html = '';

      try {
        while (html.length < READ_LIMIT) {
          const { done, value } = await reader.read();

          if (done) break;

          html += decoder.decode(value, { stream: true });
        }

        html += decoder.decode();
      } finally {
        void reader.cancel().catch(() => undefined);
      }

      return !looksMissing(html);
    } catch (error) {
      this.logger.warn(
        `Embed check failed: ${
          error instanceof Error
            ? `${error.name} ${
                (error as {
                  cause?: { code?: string };
                }).cause?.code ?? error.message
              }`
            : error
        }`,
      );

      return null;
    }
  }

  /**
   * Checks Superembed first.
   * Falls back to AutoEmbed when Superembed fails or says missing.
   *
   * A title is confirmed missing only when all configured providers
   * return missing and their respective canaries are healthy.
   */
  private async probe(
    kind: EmbedKind,
    id: number,
  ): Promise<boolean | null> {
    const candidates = this.urls(kind, id);

    if (!candidates.length) return false;

    let uncertain = false;

    for (const candidate of candidates) {
      const provider = candidate.provider as ProviderName;

      // Skip a provider that is currently paused.
      if (this.isPaused(provider)) {
        uncertain = true;
        continue;
      }

      const result = await this.probeUrl(candidate.url);

      // Title exists on this provider.
      if (result === true) {
        return true;
      }

      // Network error, timeout or request budget exceeded.
      if (result === null) {
        uncertain = true;
        continue;
      }

      // A missing result is trusted only if this provider's canary passes.
      const canaryWorks = await this.canaryOk(kind, provider);

      if (!canaryWorks) {
        uncertain = true;
      }

      // Continue to the next provider.
    }

    // Never hide titles when provider availability is uncertain.
    if (uncertain) return null;

    // Every configured provider confirmed that the title is missing.
    return false;
  }

  /** Checks one title and saves confirmed results. */
  private check(
    kind: EmbedKind,
    id: number,
  ): Promise<boolean | null> {
    const entry = key(kind, id);

    const running = this.inflight.get(entry);

    if (running) return running;

    const work = this.probe(kind, id)
      .then(async (available) => {
        if (available !== null) {
          this.remember(kind, id, available);

          if (await this.ensureTable()) {
            await this.db
              .query(
                `
                INSERT INTO embed_availability
                  (kind, tmdb_id, available, checked_at)
                VALUES ($1, $2, $3, now())
                ON CONFLICT (kind, tmdb_id)
                DO UPDATE SET
                  available = EXCLUDED.available,
                  checked_at = EXCLUDED.checked_at
                `,
                [kind, id, available],
              )
              .catch(() => undefined);
          }
        }

        return available;
      })
      .finally(() => this.inflight.delete(entry));

    this.inflight.set(entry, work);

    return work;
  }

  /** Loads stored results that have not expired into memory. */
  private async loadStored(
    targets: { kind: EmbedKind; id: number }[],
  ): Promise<void> {
    if (!targets.length || !(await this.ensureTable())) return;

    try {
      const result = await this.db.query<{
        kind: EmbedKind;
        tmdb_id: number;
        available: boolean;
        checked_at: Date;
      }>(
        `
        SELECT kind, tmdb_id, available, checked_at
        FROM embed_availability
        WHERE (kind, tmdb_id) IN (
          SELECT * FROM unnest($1::text[], $2::int[])
        )
        `,
        [
          targets.map((target) => target.kind),
          targets.map((target) => target.id),
        ],
      );

      for (const row of result.rows) {
        const expires =
          new Date(row.checked_at).getTime() +
          (row.available ? AVAILABLE_TTL_MS : MISSING_TTL_MS);

        if (expires > Date.now()) {
          this.memory.set(key(row.kind, row.tmdb_id), {
            available: row.available,
            expires,
          });
        }
      }
    } catch {
      // Fall back to live checks.
    }
  }

  private known(
    kind: EmbedKind,
    id: number,
  ): boolean | undefined {
    const hit = this.memory.get(key(kind, id));

    return hit && hit.expires > Date.now()
      ? hit.available
      : undefined;
  }

  /** Resolves availability for many titles, checking unknown ones within the budget. */
  async resolve(
    targets: { kind: EmbedKind; id: number }[],
    budgetMs = LIST_BUDGET_MS,
  ): Promise<Map<string, boolean>> {
    const unique = [
      ...new Map(
        targets.map((target) => [
          key(target.kind, target.id),
          target,
        ]),
      ).values(),
    ];

    await this.loadStored(
      unique.filter(
        (target) =>
          this.known(target.kind, target.id) === undefined,
      ),
    );

    const pending = unique.filter(
      (target) =>
        this.known(target.kind, target.id) === undefined,
    );

    if (pending.length) {
      let next = 0;

      const worker = async () => {
        while (next < pending.length) {
          const target = pending[next++];

          await this.check(target.kind, target.id);
        }
      };

      const workers = Promise.all(
        Array.from(
          {
            length: Math.min(CONCURRENCY, pending.length),
          },
          worker,
        ),
      );

      // Checks that outlive the budget keep running and are stored for the next request.
      await Promise.race([
        workers,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, budgetMs);
          timer.unref?.();
        }),
      ]);
    }

    const result = new Map<string, boolean>();

    // Only a confirmed "missing" answer hides a title.
    // Provider errors and timeouts leave titles visible.
    for (const target of unique) {
      result.set(
        key(target.kind, target.id),
        this.known(target.kind, target.id) !== false,
      );
    }

    return result;
  }

  /** Keeps non-TMDB items and TMDB items not confirmed missing by both providers. */
  async keepPlayable<T extends Item>(
    items: T[],
    budgetMs?: number,
  ): Promise<T[]> {
    const targets = items
      .map(embedTarget)
      .filter(
        (
          target,
        ): target is { kind: EmbedKind; id: number } =>
          Boolean(target),
      );

    if (!targets.length) return items;

    const playable = await this.resolve(targets, budgetMs);

    return items.filter((item) => {
      const target = embedTarget(item);

      return (
        !target ||
        playable.get(key(target.kind, target.id)) === true
      );
    });
  }

  /** Checks one provider for the admin diagnostic endpoint. */
  private async inspectProvider(
    provider: ProviderName,
    url: string,
  ) {
    const started = Date.now();

    const paused = this.isPaused(provider);

    const pausedForSeconds = Math.max(
      0,
      Math.round(
        ((this.pausedUntil.get(provider) ?? 0) - Date.now()) /
          1000,
      ),
    );

    if (paused) {
      return {
        provider,
        url,
        paused: true,
        pausedForSeconds,
        error: 'Provider temporarily paused',
      };
    }

    if (!this.takeRequestSlot()) {
      return {
        provider,
        url,
        paused: false,
        error: 'Request budget exceeded',
      };
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });

      const html = (await response.text()).slice(0, READ_LIMIT);

      const text = html
        .replace(
          /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,
          ' ',
        )
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        provider,
        url,
        paused: false,
        status: response.status,
        finalHost: new URL(response.url || url).host,
        ms: Date.now() - started,
        server: response.headers.get('server'),
        title: (/<title>([^<]*)/i.exec(html)?.[1] ?? '').trim(),
        looksMissing: looksMissing(html),
        text: text.slice(0, 300),
      };
    } catch (error) {
      return {
        provider,
        url,
        paused: false,
        ms: Date.now() - started,
        error:
          error instanceof Error
            ? `${error.name}: ${
                (error as {
                  cause?: { code?: string };
                }).cause?.code ?? error.message
              }`
            : String(error),
      };
    }
  }

  /** Raw view of provider requests for the admin diagnostic endpoint. */
  async diagnose(kind: EmbedKind = 'movie') {
    const candidates = this.urls(kind, CANARY[kind]);

    const providers = await Promise.all(
      candidates.map((candidate) =>
        this.inspectProvider(
          candidate.provider as ProviderName,
          candidate.url,
        ),
      ),
    );

    const pausedProviders = (
      ['superembed', 'autoembed'] as ProviderName[]
    ).filter((provider) => this.isPaused(provider));

    const pausedForSeconds = Math.max(
      0,
      ...pausedProviders.map((provider) =>
        Math.round(
          ((this.pausedUntil.get(provider) ?? 0) - Date.now()) /
            1000,
        ),
      ),
    );

    return {
      kind,
      url: candidates[0]?.url ?? null,
      primary: candidates[0]?.provider ?? null,
      providers,
      fallbackEnabled: candidates.some(
        (candidate) => candidate.provider === 'autoembed',
      ),
      configuredProviders: candidates.length,
      paused: pausedProviders.length > 0,
      pausedProviders,
      pausedForSeconds,
      requestsLastMinute: this.requestTimes.filter(
        (time) => Date.now() - time < 60_000,
      ).length,
      cachedResults: this.memory.size,
    };
  }

  /** Single title check, used for detail pages. */
  async isPlayable(
    kind: EmbedKind,
    id: number,
  ): Promise<boolean> {
    return (
      (await this.resolve([{ kind, id }])).get(key(kind, id)) === true
    );
  }
}
