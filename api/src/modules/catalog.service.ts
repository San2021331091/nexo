import { Injectable } from '@nestjs/common';
import { ChannelRepository, MAX_CHANNELS } from './channels/channel.repository';
import { Channel } from './channels/channel.types';
import { ContentRepository } from './catalog/content.repository';
import { TmdbList, TmdbService, tmdbIdFromSlug } from './tmdb/tmdb.service';
import { YouTubeFeedService } from './sports/youtube-feed.service';
import { ChannelHealthService } from './channels/channel-health.service';
import { EmbedAvailabilityService } from './playback/embed-availability.service';

type Item = Record<string, unknown>;
export type HomeTab = 'all' | 'live' | 'sports' | 'movies' | 'series' | 'dramas';
export interface BrowseTarget { kind: 'channels' | 'movies' | 'series'; category?: string; genre?: string; language?: string; list?: TmdbList }
export interface HomeSection { id: string; title: string; style: 'circles' | 'posters' | 'landscape' | 'ranked' | 'shorts'; items: Item[]; viewAll?: BrowseTarget }
export interface ContentQuery { limit?: number; page?: number; q?: string; genre?: string; language?: string; year?: number; list?: TmdbList }

const CHANNEL_TTL = 60_000;
const RAIL = 20;
// Categories surfaced first on the Live TV tab; the rest follow by channel count.
const CATEGORY_PRIORITY = ['Bangladesh', 'India', 'Sports', 'Movies', 'Pakistan', 'USA', 'UK'];
const AVAILABILITY_NOTE = 'Availability depends on rights and the source provider.';

@Injectable()
export class CatalogService {
  private channelCache: { expires: number; items: Channel[] } | null = null;
  constructor(private readonly channels: ChannelRepository, private readonly content: ContentRepository, private readonly tmdb: TmdbService, private readonly sports: YouTubeFeedService, private readonly health: ChannelHealthService, private readonly availability: EmbedAvailabilityService) {}

  /** Every playable channel, cached briefly so one home request reads the table once. */
  private async liveChannels(): Promise<Channel[]> {
    if (this.channelCache && this.channelCache.expires > Date.now()) return this.channelCache.items;
    const items = (await this.health.applyFresh(await this.channels.list(MAX_CHANNELS))).filter((channel) => channel.playbackUrl);
    this.channelCache = { expires: Date.now() + CHANNEL_TTL, items };
    return items;
  }

  private inCategory(channels: Channel[], category: string) { return channels.filter((channel) => channel.category.toLowerCase() === category.toLowerCase()); }

  private channelRail(id: string, title: string, channels: Channel[], category: string): HomeSection {
    return { id, title, style: 'circles', items: channels.slice(0, 30) as unknown as Item[], viewAll: { kind: 'channels', category } };
  }

  private async safe<T>(work: Promise<T>, fallback: T): Promise<T> { try { return await work; } catch { return fallback; } }

  async home(tab: HomeTab = 'all') {
    const feed = await this.feed(tab);
    // Only titles whose embed the provider confirmed are shown; one check covers every rail.
    const kept = new Set(await this.availability.keepPlayable([...feed.hero, ...feed.sections.flatMap((section) => section.items)]));
    const hero = feed.hero.filter((item) => kept.has(item)).slice(0, 8);
    const sections = feed.sections
      .map((section) => { const items = section.items.filter((item) => kept.has(item)); return { ...section, items: section.style === 'ranked' ? items.slice(0, 10) : items }; })
      .filter((section) => section.items.length);
    return { data: { tab, hero, sections, availabilityNote: AVAILABILITY_NOTE } };
  }

  private async feed(tab: HomeTab): Promise<{ hero: Item[]; sections: HomeSection[] }> {
    const channels = await this.safe(this.liveChannels(), []);
    const movies = (list: TmdbList) => this.tmdb.movieList(list);
    const series = (list: TmdbList) => this.tmdb.seriesList(list);

    if (tab === 'live') {
      const counts = new Map<string, number>();
      for (const channel of channels) counts.set(channel.category, (counts.get(channel.category) ?? 0) + 1);
      const rank = (name: string) => { const index = CATEGORY_PRIORITY.findIndex((value) => value.toLowerCase() === name.toLowerCase()); return index < 0 ? CATEGORY_PRIORITY.length : index; };
      const ordered = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
      return { hero: [], sections: ordered.map((category) => this.channelRail(`live-${category}`, category.toLowerCase() === 'sports' || category.toLowerCase() === 'movies' ? `${category} Channels` : category, this.inCategory(channels, category), category)) };
    }

    if (tab === 'sports') {
      const [feeds, latest, shorts] = await Promise.all([this.sports.feeds(), this.sports.latest(8), this.sports.shorts(30)]);
      return { hero: latest, sections: [
        this.channelRail('sports-channels', 'Sports Channels', this.inCategory(channels, 'Sports'), 'Sports'),
        { id: 'sports-shorts', title: 'Shorts', style: 'shorts', items: shorts as unknown as Item[] },
        ...feeds.map((feed): HomeSection => ({ id: `yt-${feed.channelId}`, title: feed.title, style: 'landscape', items: feed.items.slice(0, 15) as unknown as Item[] })),
      ] };
    }

    if (tab === 'movies') {
      const [trending, popular, topRated, nowPlaying, action, comedy, thriller, horror, bollywood, bangla, local, reels] = await Promise.all([
        movies('trending'), movies('popular'), movies('top_rated'), movies('now_playing'),
        this.tmdb.discoverMovies({ genre: 'Action' }), this.tmdb.discoverMovies({ genre: 'Comedy' }), this.tmdb.discoverMovies({ genre: 'Thriller' }), this.tmdb.discoverMovies({ genre: 'Horror' }),
        this.tmdb.discoverMovies({ language: 'hi' }), this.tmdb.discoverMovies({ language: 'bn' }),
        this.safe(this.content.movies({ limit: RAIL }).then((result) => result.data as Item[]), []),
        this.sports.reels('movies'),
      ]);
      return { hero: trending, sections: [
        this.channelRail('movie-channels', 'Movie Channels', this.inCategory(channels, 'Movies'), 'Movies'),
        { id: 'local-movies', title: 'Featured on NEXO', style: 'posters', items: local },
        { id: 'movies-trending', title: 'Trending', style: 'posters', items: trending.slice(0, RAIL), viewAll: { kind: 'movies', list: 'trending' } },
        { id: 'movies-reels', title: 'Reels', style: 'shorts', items: reels as unknown as Item[] },
        { id: 'movies-top-ten', title: 'Top Ten', style: 'ranked', items: popular },
        { id: 'movies-now', title: 'New on NEXO', style: 'posters', items: nowPlaying.slice(0, RAIL), viewAll: { kind: 'movies', list: 'now_playing' } },
        { id: 'movies-bollywood', title: 'Bollywood', style: 'posters', items: bollywood.slice(0, RAIL), viewAll: { kind: 'movies', language: 'hi' } },
        { id: 'movies-action', title: 'Action', style: 'posters', items: action.slice(0, RAIL), viewAll: { kind: 'movies', genre: 'Action' } },
        { id: 'movies-bangla', title: 'Bangla Movies', style: 'posters', items: bangla.slice(0, RAIL), viewAll: { kind: 'movies', language: 'bn' } },
        { id: 'movies-comedy', title: 'Comedy', style: 'posters', items: comedy.slice(0, RAIL), viewAll: { kind: 'movies', genre: 'Comedy' } },
        { id: 'movies-thriller', title: 'Thriller', style: 'posters', items: thriller.slice(0, RAIL), viewAll: { kind: 'movies', genre: 'Thriller' } },
        { id: 'movies-horror', title: 'Horror', style: 'posters', items: horror.slice(0, RAIL), viewAll: { kind: 'movies', genre: 'Horror' } },
        { id: 'movies-top-rated', title: 'Top Rated', style: 'posters', items: topRated.slice(0, RAIL), viewAll: { kind: 'movies', list: 'top_rated' } },
      ] };
    }

    if (tab === 'series') {
      const [trending, popular, topRated, crime, scifi, action, animation, local, reels] = await Promise.all([
        series('trending'), series('popular'), series('top_rated'),
        this.tmdb.discoverSeries({ genre: 'Crime' }), this.tmdb.discoverSeries({ genre: 'Sci-Fi & Fantasy' }), this.tmdb.discoverSeries({ genre: 'Action & Adventure' }), this.tmdb.discoverSeries({ genre: 'Animation' }),
        this.safe(this.content.seriesList({ limit: RAIL }).then((result) => result.data as Item[]), []),
        this.sports.reels('series'),
      ]);
      return { hero: trending, sections: [
        { id: 'local-series', title: 'Featured on NEXO', style: 'posters', items: local },
        { id: 'series-trending', title: 'Trending Series', style: 'posters', items: trending.slice(0, RAIL), viewAll: { kind: 'series', list: 'trending' } },
        { id: 'series-reels', title: 'Reels', style: 'shorts', items: reels as unknown as Item[] },
        { id: 'series-top-ten', title: 'Top Ten', style: 'ranked', items: popular },
        { id: 'series-crime', title: 'Crime', style: 'posters', items: crime.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Crime' } },
        { id: 'series-action', title: 'Action & Adventure', style: 'posters', items: action.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Action & Adventure' } },
        { id: 'series-scifi', title: 'Sci-Fi & Fantasy', style: 'posters', items: scifi.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Sci-Fi & Fantasy' } },
        { id: 'series-animation', title: 'Animation', style: 'posters', items: animation.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Animation' } },
        { id: 'series-top-rated', title: 'Top Rated', style: 'posters', items: topRated.slice(0, RAIL), viewAll: { kind: 'series', list: 'top_rated' } },
      ] };
    }

    if (tab === 'dramas') {
      const drama = (language?: string) => this.tmdb.discoverSeries({ genre: 'Drama', language });
      const [popular, korean, turkish, hindi, bangla, topRated, reels] = await Promise.all([drama(), drama('ko'), drama('tr'), drama('hi'), drama('bn'), this.tmdb.discoverSeries({ genre: 'Drama', sort: 'vote_average.desc' }), this.sports.reels('dramas')]);
      return { hero: popular, sections: [
        { id: 'dramas-popular', title: 'Popular Dramas', style: 'posters', items: popular.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Drama' } },
        { id: 'dramas-reels', title: 'Reels', style: 'shorts', items: reels as unknown as Item[] },
        { id: 'dramas-korean', title: 'Korean Dramas', style: 'posters', items: korean.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Drama', language: 'ko' } },
        { id: 'dramas-turkish', title: 'Turkish Dramas', style: 'posters', items: turkish.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Drama', language: 'tr' } },
        { id: 'dramas-hindi', title: 'Hindi Dramas', style: 'posters', items: hindi.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Drama', language: 'hi' } },
        { id: 'dramas-bangla', title: 'Bangla Dramas', style: 'posters', items: bangla.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Drama', language: 'bn' } },
        { id: 'dramas-top-rated', title: 'Top Rated Dramas', style: 'posters', items: topRated.slice(0, RAIL) },
      ] };
    }

    const [trendingMovies, popularMovies, topRated, trendingSeries, bollywood, action, dramas, highlights, shorts, curated] = await Promise.all([
      movies('trending'), movies('popular'), movies('top_rated'), series('trending'),
      this.tmdb.discoverMovies({ language: 'hi' }), this.tmdb.discoverMovies({ genre: 'Action' }), this.tmdb.discoverSeries({ genre: 'Drama' }),
      this.sports.latest(12), this.sports.shorts(20), this.safe(this.curatedSections(channels), []),
    ]);
    // Alternate movies and series in the hero so both are represented.
    const hero: Item[] = [];
    for (let index = 0; index < 4; index++) { if (trendingMovies[index]) hero.push(trendingMovies[index]); if (trendingSeries[index]) hero.push(trendingSeries[index]); }
    const bangladesh = this.inCategory(channels, 'Bangladesh');
    const liveNow = [...bangladesh, ...channels.filter((channel) => !bangladesh.includes(channel))];
    return { hero, sections: [
      this.channelRail('live', 'Live TV', liveNow, ''),
      ...curated,
      { id: 'movies-trending', title: 'Trending', style: 'posters', items: trendingMovies.slice(0, RAIL), viewAll: { kind: 'movies', list: 'trending' } },
      this.channelRail('sports-channels', 'Sports Channels', this.inCategory(channels, 'Sports'), 'Sports'),
      { id: 'sports-highlights', title: 'Sports Highlights', style: 'landscape', items: highlights as unknown as Item[] },
      { id: 'sports-shorts', title: 'Shorts', style: 'shorts', items: shorts as unknown as Item[] },
      { id: 'movies-top-ten', title: 'Top Ten', style: 'ranked', items: popularMovies },
      { id: 'series-trending', title: 'Trending Series', style: 'posters', items: trendingSeries.slice(0, RAIL), viewAll: { kind: 'series', list: 'trending' } },
      { id: 'movies-bollywood', title: 'Bollywood', style: 'posters', items: bollywood.slice(0, RAIL), viewAll: { kind: 'movies', language: 'hi' } },
      this.channelRail('movie-channels', 'Movie Channels', this.inCategory(channels, 'Movies'), 'Movies'),
      { id: 'movies-action', title: 'Action', style: 'posters', items: action.slice(0, RAIL), viewAll: { kind: 'movies', genre: 'Action' } },
      { id: 'dramas-popular', title: 'Dramas', style: 'posters', items: dramas.slice(0, RAIL), viewAll: { kind: 'series', genre: 'Drama' } },
      { id: 'movies-top-rated', title: 'Top Rated', style: 'posters', items: topRated.slice(0, RAIL), viewAll: { kind: 'movies', list: 'top_rated' } },
    ] };
  }

  /** Operator curated collections from the admin panel, resolved to full items. */
  private async curatedSections(channels: Channel[]): Promise<HomeSection[]> {
    const collections = await this.content.collections();
    if (!collections.length) return [];
    const [movies, series] = await Promise.all([this.content.movies({ limit: 100 }), this.content.seriesList({ limit: 100 })]);
    const lookup = new Map<string, Item>();
    for (const channel of channels) lookup.set(`channel:${channel.id}`, channel as unknown as Item);
    for (const movie of movies.data) lookup.set(`movie:${movie.id}`, movie);
    for (const show of series.data) lookup.set(`series:${show.id}`, show);
    return collections.map((collection): HomeSection => {
      const entries = (collection.items as Item[]).map((entry) => lookup.get(`${entry.type}:${entry.id}`)).filter((value): value is Item => Boolean(value));
      return { id: `collection-${collection.id}`, title: String(collection.title), style: entries.every((entry) => entry.type === 'channel') ? 'circles' : 'posters', items: entries };
    });
  }

  async search(q: string, filters: { genre?: string; language?: string; year?: number; category?: string } = {}) {
    const query = q.trim();
    if (!query) return { data: [], meta: { query: q, count: 0 } };
    const [channels, movies, series, tmdbMovies, tmdbSeries] = await Promise.all([
      this.safe(this.channels.list(50, query, filters.category).then((items) => this.health.applyFresh(items)), []),
      this.safe(this.content.movies({ limit: 50, q: query, genre: filters.genre, language: filters.language, year: filters.year }).then((result) => result.data as Item[]), []),
      this.safe(this.content.seriesList({ limit: 50, q: query, genre: filters.genre, language: filters.language, year: filters.year }).then((result) => result.data as Item[]), []),
      this.tmdb.searchMovies(query), this.tmdb.searchSeries(query),
    ]);
    const [playableMovies, playableSeries] = await Promise.all([this.availability.keepPlayable(tmdbMovies), this.availability.keepPlayable(tmdbSeries)]);
    const data = [...channels, ...movies, ...series, ...playableMovies.slice(0, 15), ...playableSeries.slice(0, 15)];
    return { data, meta: { query: q, count: data.length } };
  }

  async movies(query: ContentQuery) {
    const page = query.page ?? 1;
    const local = page === 1 && !query.list ? await this.safe(this.content.movies({ ...query, page: 1, limit: 50 }).then((result) => result.data as Item[]), []) : [];
    const remote: Item[] = query.q?.trim() ? await this.tmdb.searchMovies(query.q.trim(), page)
      : query.genre || query.language || query.year ? await this.tmdb.discoverMovies({ genre: query.genre, language: query.language, year: query.year, page, sort: query.list === 'top_rated' ? 'vote_average.desc' : undefined })
      : await this.tmdb.movieList(query.list ?? 'popular', page);
    // hasMore follows TMDB's page size, not how many titles passed the embed check.
    const data = [...local, ...(await this.availability.keepPlayable(remote))];
    return { data, meta: { count: data.length, page, limit: data.length, hasMore: remote.length >= 15 } };
  }

  async movieBySlug(slug: string) { const id = tmdbIdFromSlug(slug); if (!id) return this.content.movieBySlug(slug); return (await this.availability.isPlayable('movie', id)) ? this.tmdb.movie(id) : null; }

  async series(query: ContentQuery) {
    const page = query.page ?? 1;
    const local = page === 1 && !query.list ? await this.safe(this.content.seriesList({ ...query, page: 1, limit: 50 }).then((result) => result.data as Item[]), []) : [];
    const remote: Item[] = query.q?.trim() ? await this.tmdb.searchSeries(query.q.trim(), page)
      : query.genre || query.language || query.year ? await this.tmdb.discoverSeries({ genre: query.genre, language: query.language, year: query.year, page, sort: query.list === 'top_rated' ? 'vote_average.desc' : undefined })
      : await this.tmdb.seriesList(query.list ?? 'popular', page);
    // hasMore follows TMDB's page size, not how many titles passed the embed check.
    const data = [...local, ...(await this.availability.keepPlayable(remote))];
    return { data, meta: { count: data.length, page, limit: data.length, hasMore: remote.length >= 15 } };
  }

  async seriesBySlug(slug: string) { const id = tmdbIdFromSlug(slug); if (!id) return this.content.seriesBySlug(slug); return (await this.availability.isPlayable('tv', id)) ? this.tmdb.series(id) : null; }
  async seasons(slug: string) { const id = tmdbIdFromSlug(slug); if (!id) return this.content.seasons(slug); return (await this.availability.isPlayable('tv', id)) ? this.tmdb.seasons(id) : []; }
  episode(id: string) { return this.content.episode(id); }
  collections() { return this.content.collections(); }
}
