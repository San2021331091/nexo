import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TmdbService, watchRegion } from '../tmdb/tmdb.service';
import { YouTubeFeedService } from '../sports/youtube-feed.service';
import { LibraryGroup, YouTubeLibraryService } from '../library/youtube-library.service';

// NEXO's chat assistant. The model (any OpenRouter model, DeepSeek by default)
// answers from live NEXO data through tools: TMDB for movies, series and dramas,
// the official YouTube library for free full episodes and movies, and the
// official sports channels. OPENROUTER_API_KEY enables it; OPENROUTER_MODEL
// picks the model.
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
/** The API runs in a 30 second Vercel function; the whole answer must fit in it. */
const BUDGET_MS = 25_000;
const MAX_TOOL_ROUNDS = 3;
const MAX_CARDS = 8;

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
type Item = Record<string, unknown>;
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

const TOOLS = [
  { type: 'function', function: { name: 'search_titles', description: 'Search movies and TV series (including dramas and web series) by name, actor-free keywords or topic.', parameters: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['movie', 'series', 'both'] } }, required: ['query'] } } },
  { type: 'function', function: { name: 'trending', description: 'Current trending, popular, top rated, now playing or upcoming titles. For dramas, optionally filter by original language (ISO 639-1, e.g. ko, tr, hi, bn).', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['movies', 'series', 'dramas'] }, list: { type: 'string', enum: ['trending', 'popular', 'top_rated', 'now_playing', 'upcoming', 'on_the_air'] }, language: { type: 'string' } }, required: ['kind'] } } },
  { type: 'function', function: { name: 'title_details', description: 'Details for one title by TMDB id: overview, year, rating, genres, runtime, trailer, and which free services stream it in the viewer\'s country.', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['movie', 'series'] }, tmdbId: { type: 'integer' } }, required: ['type', 'tmdbId'] } } },
  { type: 'function', function: { name: 'free_full_videos', description: 'Newest full episodes or full movies uploaded by official channels on YouTube, playable free in NEXO.', parameters: { type: 'object', properties: { group: { type: 'string', enum: ['movies', 'series', 'dramas'] } }, required: ['group'] } } },
  { type: 'function', function: { name: 'sports_now', description: 'Sports broadcasts live right now on official channels, plus the latest official sports videos and highlights.', parameters: { type: 'object', properties: {} } } },
];

const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** What the model sees for one item: short and without URLs. Exported for tests. */
export function compactItem(item: Item) {
  return {
    title: text(item.title ?? item.name, 160), type: item.type, tmdbId: item.tmdbId ?? undefined, year: item.year ?? undefined,
    rating: item.rating ?? undefined, genres: Array.isArray(item.genres) && item.genres.length ? item.genres.slice(0, 3) : undefined,
    channel: item.type === 'video' ? text(item.category, 80) : undefined, overview: text(item.synopsis, 220) || undefined,
  };
}

/** The items whose titles the reply mentions, or the first results when it names none. Exported for tests. */
export function pickCards(reply: string, items: Item[]): Item[] {
  const unique = [...new Map(items.map((item) => [String(item.id), item])).values()];
  const lower = reply.toLowerCase();
  const named = unique.filter((item) => { const title = text(item.title ?? item.name, 160).toLowerCase(); return title.length >= 2 && lower.includes(title); });
  return (named.length ? named : unique.slice(0, 4)).slice(0, MAX_CARDS);
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  constructor(private readonly tmdb: TmdbService, private readonly sports: YouTubeFeedService, private readonly library: YouTubeLibraryService) {}

  get configured() { return Boolean(process.env.OPENROUTER_API_KEY?.trim()); }
  private get model() { return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL; }

  private systemPrompt(region: string) {
    const today = new Date().toISOString().slice(0, 10);
    return [
      `You are NEXO Assistant inside the NEXO streaming app. Today is ${today}. The viewer's country is ${region}.`,
      'You help people find movies, TV series, web series, dramas and sports, and answer questions about them.',
      'For anything current (what is trending, new, airing, live, or where to watch) call the tools first; never guess release dates, ratings, scores or schedules.',
      'If the tools do not have the answer, say so plainly. Do not make up titles, scores or fixtures.',
      'Only point people to NEXO and to official or licensed services. Never suggest pirate sites, torrents, or unofficial streams, and refuse requests for them.',
      'Write in the language the viewer uses. Use plain text without markdown headings or tables; short lists with "•" are fine. Keep answers brief.',
      'Mention titles by their exact name so the app can show them as cards.',
    ].join('\n');
  }

  private async complete(messages: Message[], withTools: boolean, deadline: number): Promise<Message> {
    const remaining = deadline - Date.now();
    if (remaining < 2_000) throw new Error('budget');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`, 'Content-Type': 'application/json', 'X-Title': 'NEXO' },
      body: JSON.stringify({ model: this.model, messages, max_tokens: 700, temperature: 0.4, ...(withTools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }),
      signal: AbortSignal.timeout(remaining),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: Message }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('OpenRouter returned no message');
    return message;
  }

  private async runTool(name: string, rawArgs: string, region: string): Promise<Item[] | Item> {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(rawArgs || '{}') as Record<string, unknown>; } catch { return { error: 'Arguments were not valid JSON.' }; }
    const kindOf = (value: unknown, allowed: string[], fallback: string) => (typeof value === 'string' && allowed.includes(value) ? value : fallback);
    switch (name) {
      case 'search_titles': {
        const query = text(args.query, 100);
        if (!query) return { error: 'query is required' };
        const kind = kindOf(args.kind, ['movie', 'series', 'both'], 'both');
        const [movies, series] = await Promise.all([kind === 'series' ? [] : this.tmdb.searchMovies(query), kind === 'movie' ? [] : this.tmdb.searchSeries(query)]);
        return [...movies.slice(0, 6), ...series.slice(0, 6)] as Item[];
      }
      case 'trending': {
        const kind = kindOf(args.kind, ['movies', 'series', 'dramas'], 'movies');
        const list = kindOf(args.list, ['trending', 'popular', 'top_rated', 'now_playing', 'upcoming', 'on_the_air'], 'trending') as Parameters<TmdbService['movieList']>[0];
        const language = typeof args.language === 'string' && /^[a-z]{2}$/i.test(args.language) ? args.language.toLowerCase() : undefined;
        const items = kind === 'movies' ? await this.tmdb.movieList(list) : kind === 'series' && !language ? await this.tmdb.seriesList(list) : await this.tmdb.discoverSeries({ genre: kind === 'dramas' ? 'Drama' : undefined, language, sort: list === 'top_rated' ? 'vote_average.desc' : 'popularity.desc' });
        return items.slice(0, 10) as Item[];
      }
      case 'title_details': {
        const id = Number(args.tmdbId);
        if (!Number.isInteger(id) || id <= 0) return { error: 'tmdbId must be a positive integer' };
        const series = args.type === 'series';
        const [details, free] = await Promise.all([series ? this.tmdb.series(id) : this.tmdb.movie(id), this.tmdb.freeWatch(series ? 'tv' : 'movie', id, region)]);
        if (!details) return { error: 'Title not found' };
        return [{ ...details, freeServices: free.providers.map((provider) => `${provider.name} (${provider.kind === 'ads' ? 'free with ads' : 'free'})`) }];
      }
      case 'free_full_videos':
        return (await this.library.latest(kindOf(args.group, ['movies', 'series', 'dramas'], 'dramas') as LibraryGroup, 10)) as unknown as Item[];
      case 'sports_now': {
        const [live, latest] = await Promise.all([this.sports.liveNow(), this.sports.latest(8)]);
        return [...live.map((item) => ({ ...item, synopsis: 'LIVE NOW' })), ...latest] as unknown as Item[];
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  /** One assistant reply to the conversation, with the titles it mentions as playable cards. */
  async chat(history: ChatTurn[], regionCode?: string): Promise<{ reply: string; items: Item[] }> {
    if (!this.configured) throw new ServiceUnavailableException('The assistant is not configured.');
    const region = watchRegion(regionCode);
    const deadline = Date.now() + BUDGET_MS;
    const messages: Message[] = [{ role: 'system', content: this.systemPrompt(region) }, ...history.slice(-12).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) }))];
    const found: Item[] = [];
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const message = await this.complete(messages, round < MAX_TOOL_ROUNDS, deadline);
        const calls = (message.tool_calls ?? []).filter((call) => call?.function?.name).slice(0, 4);
        if (!calls.length) {
          const reply = text(message.content, 4000) || "Sorry, I couldn't find an answer to that.";
          return { reply, items: pickCards(reply, found) };
        }
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
        const results = await Promise.all(calls.map((call) => this.runTool(call.function.name, call.function.arguments, region).catch((error) => ({ error: error instanceof Error ? error.message : 'Tool failed' }))));
        calls.forEach((call, index) => {
          const result = results[index];
          if (Array.isArray(result)) found.push(...result.filter((item) => item.id));
          const forModel = Array.isArray(result) ? result.map((item) => ({ ...compactItem(item), ...(item.freeServices ? { freeServices: item.freeServices } : {}) })) : result;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(forModel).slice(0, 6000) });
        });
      }
      return { reply: "Sorry, that took too many steps. Try asking in a simpler way.", items: pickCards('', found) };
    } catch (error) {
      this.logger.warn(`Assistant failed: ${error instanceof Error ? error.message : 'error'}`);
      throw new ServiceUnavailableException('The assistant is busy right now. Please try again.');
    }
  }
}
