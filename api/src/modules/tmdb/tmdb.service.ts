import { Injectable, Logger } from '@nestjs/common';
import { PlaybackProviders } from '../playback/playback-providers';

type Row = Record<string, unknown>;
export type TmdbList = 'trending' | 'popular' | 'top_rated' | 'now_playing' | 'upcoming' | 'on_the_air';
export interface DiscoverQuery { genre?: string; language?: string; year?: number; page?: number; sort?: string }

const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const LIST_TTL = 30 * 60_000;
const DETAIL_TTL = 6 * 60 * 60_000;

export const MOVIE_GENRES: Record<number, string> = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 53: 'Thriller', 10752: 'War', 37: 'Western' };
export const TV_GENRES: Record<number, string> = { 10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western' };
// Viewer facing names that differ between the movie and TV genre lists.
const TV_GENRE_ALIASES: Record<string, number> = { action: 10759, adventure: 10759, 'science fiction': 10765, fantasy: 10765, thriller: 9648, romance: 18 };

const image = (path: unknown, size: string) => (typeof path === 'string' && path ? `${IMAGE_BASE}/${size}${path}` : null);
const year = (value: unknown) => { const parsed = typeof value === 'string' ? Number(value.slice(0, 4)) : Number.NaN; return Number.isInteger(parsed) && parsed > 1800 ? parsed : null; };
const rows = (body: Row | null): Row[] => (Array.isArray(body?.results) ? (body.results as Row[]) : []);

/** Picks the best YouTube trailer from a detail response fetched with `append_to_response=videos`. */
export function trailerUrl(row: Row | null): string | null {
  const videos = rows((row?.videos ?? null) as Row | null).filter((video) => video.site === 'YouTube' && typeof video.key === 'string' && /^[\w-]{6,20}$/.test(video.key));
  const score = (video: Row) => (video.type === 'Trailer' ? 4 : video.type === 'Teaser' ? 2 : 0) + (video.official ? 1 : 0);
  const best = videos.filter((video) => score(video) >= 2).sort((a, b) => score(b) - score(a))[0];
  return best ? `https://www.youtube.com/watch?v=${String(best.key)}` : null;
}

export function genreId(kind: 'movie' | 'tv', genre: string | undefined): number | null {
  const value = (genre ?? '').trim().toLowerCase();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (kind === 'tv' && TV_GENRE_ALIASES[value]) return TV_GENRE_ALIASES[value];
  const match = Object.entries(kind === 'movie' ? MOVIE_GENRES : TV_GENRES).find(([, name]) => name.toLowerCase() === value);
  return match ? Number(match[0]) : null;
}

/** Slugs for TMDB sourced titles look like `tmdb-550`. */
export function tmdbIdFromSlug(slug: string): number | null {
  const match = /^tmdb-(\d{1,9})$/.exec(slug);
  return match ? Number(match[1]) : null;
}

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);
  private readonly cache = new Map<string, { expires: number; value: Row | null }>();
  constructor(private readonly providers: PlaybackProviders) {}

  get configured() { return Boolean(process.env.TMDB_API_KEY?.trim()); }

  private async get(path: string, params: Record<string, string | number | undefined> = {}, ttl = LIST_TTL): Promise<Row | null> {
    const key = process.env.TMDB_API_KEY?.trim();
    if (!key) return null;
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    const cacheKey = url.pathname + url.search;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;
    // v4 read tokens are JWTs and go in the header; v3 keys go in the query.
    const bearer = key.startsWith('eyJ');
    if (!bearer) url.searchParams.set('api_key', key);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) { this.logger.warn(`TMDB ${path} responded ${response.status}`); return hit?.value ?? null; }
      const value = (await response.json()) as Row;
      if (this.cache.size > 2000) for (const [entry, item] of this.cache) if (item.expires <= Date.now()) this.cache.delete(entry);
      this.cache.set(cacheKey, { expires: Date.now() + ttl, value });
      return value;
    } catch (error) {
      this.logger.warn(`TMDB ${path} failed: ${error instanceof Error ? error.name : 'error'}`);
      return hit?.value ?? null;
    }
  }

  private genres(row: Row, names: Record<number, string>): string[] {
    if (Array.isArray(row.genres)) return (row.genres as Row[]).map((genre) => String(genre.name ?? '')).filter(Boolean);
    return (Array.isArray(row.genre_ids) ? (row.genre_ids as number[]) : []).map((id) => names[id]).filter(Boolean);
  }

  private movieItem(row: Row) {
    const id = Number(row.id);
    const playbackUrl = this.providers.movieEmbed(id);
    return { id: `tmdb-movie-${id}`, slug: `tmdb-${id}`, tmdbId: id, name: String(row.title ?? row.original_title ?? 'Untitled'), title: String(row.title ?? row.original_title ?? 'Untitled'), type: 'movie', category: 'Movie', synopsis: String(row.overview ?? ''), posterUrl: image(row.poster_path, 'w500'), backdropUrl: image(row.backdrop_path, 'w780'), year: year(row.release_date), genres: this.genres(row, MOVIE_GENRES), language: String(row.original_language ?? ''), durationMinutes: typeof row.runtime === 'number' && row.runtime > 0 ? row.runtime : null, rating: typeof row.vote_average === 'number' ? Math.round(row.vote_average * 10) / 10 : null, playbackUrl, playbackKind: playbackUrl ? 'iframe' : 'unavailable' };
  }

  private seriesItem(row: Row) {
    const id = Number(row.id);
    return { id: `tmdb-tv-${id}`, slug: `tmdb-${id}`, tmdbId: id, name: String(row.name ?? row.original_name ?? 'Untitled'), title: String(row.name ?? row.original_name ?? 'Untitled'), type: 'series', category: 'Series', synopsis: String(row.overview ?? ''), posterUrl: image(row.poster_path, 'w500'), backdropUrl: image(row.backdrop_path, 'w780'), year: year(row.first_air_date), genres: this.genres(row, TV_GENRES), language: String(row.original_language ?? ''), rating: typeof row.vote_average === 'number' ? Math.round(row.vote_average * 10) / 10 : null };
  }

  private usable(items: Row[]) { return items.filter((row) => row.id && row.poster_path && !row.adult); }

  async movieList(list: TmdbList = 'popular', page = 1) {
    const path = list === 'trending' ? '/trending/movie/week' : `/movie/${list === 'on_the_air' ? 'now_playing' : list}`;
    return this.usable(rows(await this.get(path, { page }))).map((row) => this.movieItem(row));
  }

  async seriesList(list: TmdbList = 'popular', page = 1) {
    const name = list === 'now_playing' || list === 'upcoming' ? 'on_the_air' : list;
    const path = name === 'trending' ? '/trending/tv/week' : `/tv/${name}`;
    return this.usable(rows(await this.get(path, { page }))).map((row) => this.seriesItem(row));
  }

  async discoverMovies({ genre, language, year: releaseYear, page = 1, sort = 'popularity.desc' }: DiscoverQuery) {
    const body = await this.get('/discover/movie', { with_genres: genreId('movie', genre) ?? undefined, with_original_language: language?.toLowerCase(), primary_release_year: releaseYear, sort_by: sort, 'vote_count.gte': sort.startsWith('vote_average') ? 200 : undefined, include_adult: 'false', page });
    return this.usable(rows(body)).map((row) => this.movieItem(row));
  }

  async discoverSeries({ genre, language, year: firstAirYear, page = 1, sort = 'popularity.desc' }: DiscoverQuery) {
    const body = await this.get('/discover/tv', { with_genres: genreId('tv', genre) ?? undefined, with_original_language: language?.toLowerCase(), first_air_date_year: firstAirYear, sort_by: sort, 'vote_count.gte': sort.startsWith('vote_average') ? 200 : undefined, include_adult: 'false', page });
    return this.usable(rows(body)).map((row) => this.seriesItem(row));
  }

  async searchMovies(query: string, page = 1) { return this.usable(rows(await this.get('/search/movie', { query, page, include_adult: 'false' }, 10 * 60_000))).map((row) => this.movieItem(row)); }
  async searchSeries(query: string, page = 1) { return this.usable(rows(await this.get('/search/tv', { query, page, include_adult: 'false' }, 10 * 60_000))).map((row) => this.seriesItem(row)); }

  async movie(id: number) { const row = await this.get(`/movie/${id}`, { append_to_response: 'videos' }, DETAIL_TTL); return row?.id && !row.adult ? { ...this.movieItem(row), trailerUrl: trailerUrl(row) } : null; }
  async series(id: number) { const row = await this.get(`/tv/${id}`, { append_to_response: 'videos' }, DETAIL_TTL); return row?.id && !row.adult ? { ...this.seriesItem(row), trailerUrl: trailerUrl(row) } : null; }

  /** Seasons with their aired episodes; each episode carries its Superembed embed. */
  async seasons(id: number) {
    const show = await this.get(`/tv/${id}`, {}, DETAIL_TTL);
    if (!show?.id) return [];
    const numbers = (Array.isArray(show.seasons) ? (show.seasons as Row[]) : []).map((season) => Number(season.season_number)).filter((value) => Number.isInteger(value) && value >= 1).slice(0, 60);
    const today = new Date().toISOString().slice(0, 10);
    const seasons: { id: string; seasonNumber: number; title: string; episodes: Row[] }[] = [];
    // TMDB allows up to 20 appended sub-requests per call.
    for (let index = 0; index < numbers.length; index += 20) {
      const chunk = numbers.slice(index, index + 20);
      const body = await this.get(`/tv/${id}`, { append_to_response: chunk.map((value) => `season/${value}`).join(',') }, DETAIL_TTL);
      for (const number of chunk) {
        const season = body?.[`season/${number}`] as Row | undefined;
        if (!season) continue;
        const episodes = (Array.isArray(season.episodes) ? (season.episodes as Row[]) : [])
          .filter((episode) => typeof episode.air_date === 'string' && episode.air_date <= today)
          .map((episode) => {
            const episodeNumber = Number(episode.episode_number);
            const playbackUrl = this.providers.episodeEmbed(id, number, episodeNumber);
            return { id: `tmdb-tv-${id}-s${number}e${episodeNumber}`, episodeNumber, title: String(episode.name ?? `Episode ${episodeNumber}`), synopsis: String(episode.overview ?? ''), durationMinutes: typeof episode.runtime === 'number' && episode.runtime > 0 ? episode.runtime : null, stillUrl: image(episode.still_path, 'w300'), playbackUrl, playbackKind: playbackUrl ? 'iframe' : 'unavailable' };
          });
        if (episodes.length) seasons.push({ id: `tmdb-tv-${id}-s${number}`, seasonNumber: number, title: String(season.name ?? `Season ${number}`), episodes });
      }
    }
    return seasons;
  }
}
