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
  { type: 'function', function: { name: 'save_memory', description: 'Remember a lasting fact about the viewer for future chats: favourite genres, languages, teams, actors, titles they loved or disliked, or anything they ask you to remember. One short fact per call, written in the third person (e.g. "Loves Korean romance dramas").', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Search the web for current facts NEXO tools do not cover: entertainment and sports news, release dates, box office, awards, cast announcements, match results, standings, schedules. Returns a short answer and sources with snippets.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'A focused search query, including the year when it matters.' }, news: { type: 'boolean', description: 'true for recent news and results from the last two weeks.' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'sports_now', description: 'Sports broadcasts live right now on official channels, plus the latest official sports videos and highlights.', parameters: { type: 'object', properties: {} } } },
];

/** Web search uses Tavily: on when TAVILY_API_KEY is set, unless ASSISTANT_WEB_SEARCH=off. */
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const webSearchEnabled = () => Boolean(process.env.TAVILY_API_KEY?.trim()) && !['off', 'disabled', 'false', 'none'].includes((process.env.ASSISTANT_WEB_SEARCH ?? '').trim().toLowerCase());
const toolsFor = () => (webSearchEnabled() ? TOOLS : TOOLS.filter((tool) => tool.function.name !== 'web_search'));

const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** What the model sees for one item: short and without URLs. Exported for tests. */
export function compactItem(item: Item) {
  return {
    title: text(item.title ?? item.name, 160), type: item.type, tmdbId: item.tmdbId ?? undefined, year: item.year ?? undefined,
    rating: item.rating ?? undefined, genres: Array.isArray(item.genres) && item.genres.length ? item.genres.slice(0, 3) : undefined,
    channel: item.type === 'video' ? text(item.category, 80) : undefined, overview: text(item.synopsis, 220) || undefined,
  };
}

/** The items whose titles the reply mentions; none when it names none, so unrelated results never show. Exported for tests. */
export function pickCards(reply: string, items: Item[]): Item[] {
  const unique = [...new Map(items.map((item) => [String(item.id), item])).values()];
  const lower = reply.toLowerCase();
  return unique.filter((item) => { const title = text(item.title ?? item.name, 160).toLowerCase(); return title.length >= 2 && lower.includes(title); }).slice(0, MAX_CARDS);
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  constructor(private readonly tmdb: TmdbService, private readonly sports: YouTubeFeedService, private readonly library: YouTubeLibraryService) {}

  get configured() { return Boolean(process.env.OPENROUTER_API_KEY?.trim()); }
  /** What is switched on, without any secrets; for checking a deployment. */
  status() { return { configured: this.configured, model: this.model, webSearch: webSearchEnabled() }; }
  private get model() { return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL; }

  private systemPrompt(region: string, memory: string[]) {
    const today = new Date().toISOString().slice(0, 10);
    const remembered = memory.length ? ['What you remember about this viewer from earlier chats (use it to personalise; do not list it back unless asked):', ...memory.map((fact) => `- ${fact}`)] : [];
    return [
      `You are NEXO Assistant inside the NEXO streaming app. Today is ${today}. The viewer's country is ${region}.`,
      'You help people find movies, TV series, web series, dramas and sports, and answer any question about them, like a knowledgeable film and sports expert.',
      'Answer general questions (plots, cast, directors, history, trivia, comparisons, sports rules, players and teams, recommendations by taste) from your own knowledge.',
      'For anything current or time sensitive (trending, new, airing, live, upcoming, release dates, box office, awards, news, match results, standings, schedules, where to watch) use the NEXO tools first; when they do not cover it, call web_search. Never guess dates, scores or schedules.',
      'When you used web_search, cite the sources as Markdown links, e.g. [Variety](https://variety.com/...). If you still cannot find something, say so plainly; do not make up titles, scores or fixtures.',
      'Only point people to NEXO and to official or licensed services. Never suggest pirate sites, torrents, or unofficial streams, and refuse requests for them.',
      'When the viewer shares a lasting preference or asks you to remember something, call save_memory, then say briefly that you will remember it.',
      'Write in the language the viewer uses, formatted in Markdown like ChatGPT:',
      '- Open with one short sentence that answers directly.',
      '- Use "### " headings only to split longer answers into sections.',
      '- Use numbered lists for rankings and "-" bullets for options. Put each title in **bold** with its year, then " — " and a one line reason, with rating, genre or channel on that line, e.g. 1. **Dune: Part Two** (2024) — ⭐ 8.2 · Sci-Fi · An epic sequel with stunning visuals.',
      '- Keep it scannable: no walls of text, no tables, only a few emojis.',
      '- End with one short follow-up question or suggestion in *italics*.',
      'Mention titles by their exact name so the app can show them as cards.',
      ...remembered,
    ].join('\n');
  }

  private async complete(messages: Message[], withTools: boolean, deadline: number): Promise<Message> {
    const remaining = deadline - Date.now();
    if (remaining < 2_000) throw new Error('budget');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`, 'Content-Type': 'application/json', 'X-Title': 'NEXO' },
      body: JSON.stringify({ model: this.model, messages, max_tokens: 1000, temperature: 0.4, ...(withTools ? { tools: toolsFor(), tool_choice: 'auto' } : {}) }),
      signal: AbortSignal.timeout(remaining),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: Message }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('OpenRouter returned no message');
    return message;
  }

  /** Web results from Tavily: its short answer plus the top sources with snippets. */
  private async webSearch(query: string, news: boolean, deadline: number): Promise<Item> {
    const remaining = Math.min(deadline - Date.now() - 4_000, 10_000);
    if (remaining < 2_000) return { error: 'No time left for a web search.' };
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY?.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topic: news ? 'news' : 'general', ...(news ? { days: 14 } : {}), search_depth: 'basic', max_results: 5, include_answer: true }),
      signal: AbortSignal.timeout(remaining),
    });
    if (!response.ok) return { error: `Web search failed (${response.status}).` };
    const body = (await response.json()) as { answer?: string; results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
    const sources = (body.results ?? []).flatMap((result) => {
      const url = result.url ?? '';
      if (!/^https:\/\//.test(url)) return [];
      return [{ title: text(result.title, 120) || new URL(url).hostname, url, snippet: text(result.content, 400), published: text(result.published_date, 40) || undefined }];
    });
    return { answer: text(body.answer, 1200) || undefined, sources: [...new Map(sources.map((source) => [source.url, source])).values()].slice(0, 5) };
  }

  private async runTool(name: string, rawArgs: string, region: string, remembered: string[], deadline: number): Promise<Item[] | Item> {
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
      case 'web_search': {
        const query = text(args.query, 200);
        if (!query) return { error: 'query is required' };
        if (!webSearchEnabled()) return { error: 'Web search is turned off.' };
        return this.webSearch(query, args.news === true, deadline);
      }
      case 'save_memory': {
        const fact = text(args.fact, 200).replace(/\s+/g, ' ');
        if (fact.length < 3) return { error: 'fact is required' };
        if (remembered.length < 5) remembered.push(fact);
        return { saved: true };
      }
      case 'sports_now': {
        const [live, latest] = await Promise.all([this.sports.liveNow(), this.sports.latest(8)]);
        return [...live.map((item) => ({ ...item, synopsis: 'LIVE NOW' })), ...latest] as unknown as Item[];
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  /** One assistant reply to the conversation, with the titles it mentions as playable cards. */
  async chat(history: ChatTurn[], regionCode?: string, memory: string[] = []): Promise<{ reply: string; items: Item[]; remembered: string[] }> {
    if (!this.configured) throw new ServiceUnavailableException('The assistant is not configured.');
    const region = watchRegion(regionCode);
    const deadline = Date.now() + BUDGET_MS;
    const facts = memory.map((fact) => text(fact, 200)).filter(Boolean).slice(0, 30);
    const remembered: string[] = [];
    const messages: Message[] = [{ role: 'system', content: this.systemPrompt(region, facts) }, ...history.slice(-12).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) }))];
    const found: Item[] = [];
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const message = await this.complete(messages, round < MAX_TOOL_ROUNDS, deadline);
        const calls = (message.tool_calls ?? []).filter((call) => call?.function?.name).slice(0, 4);
        if (!calls.length) {
          const reply = text(message.content, 4000) || "Sorry, I couldn't find an answer to that.";
          return { reply, items: pickCards(reply, found), remembered };
        }
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
        const results = await Promise.all(calls.map((call) => this.runTool(call.function.name, call.function.arguments, region, remembered, deadline).catch((error) => ({ error: error instanceof Error ? error.message : 'Tool failed' }))));
        calls.forEach((call, index) => {
          const result = results[index];
          if (Array.isArray(result)) found.push(...result.filter((item) => item.id));
          const forModel = Array.isArray(result) ? result.map((item) => ({ ...compactItem(item), ...(item.freeServices ? { freeServices: item.freeServices } : {}) })) : result;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(forModel).slice(0, 6000) });
        });
      }
      return { reply: "Sorry, that took too many steps. Try asking in a simpler way.", items: pickCards('', found), remembered };
    } catch (error) {
      this.logger.warn(`Assistant failed: ${error instanceof Error ? error.message : 'error'}`);
      throw new ServiceUnavailableException('The assistant is busy right now. Please try again.');
    }
  }
}
