import { Injectable } from '@nestjs/common';
import { PostgresService } from '../database/postgres.service';
import { validatePlaybackUrl } from '../playback/url-validator';

type ContentRow = Record<string, unknown>;
const safeImage = (value: unknown): string | null => { if (typeof value !== 'string' || !value) return null; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null; } catch { return null; } };
const array = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];

@Injectable()
export class ContentRepository {
  constructor(private readonly db: PostgresService) {}

  private movie(row: ContentRow) { const playbackUrl=validatePlaybackUrl(row.playback_url);return { id: String(row.id), slug: String(row.slug), name: String(row.title), title: String(row.title), type: 'movie', synopsis: String(row.synopsis ?? ''), posterUrl: safeImage(row.poster_url), backdropUrl: safeImage(row.backdrop_url), year: row.release_year == null ? null : Number(row.release_year), genres: array(row.genres), language: String(row.language ?? ''), durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes), playbackUrl, playbackKind: playbackUrl ? String(row.playback_kind) : 'unavailable' }; }
  private series(row: ContentRow) { return { id: String(row.id), slug: String(row.slug), name: String(row.title), title: String(row.title), type: 'series', synopsis: String(row.synopsis ?? ''), posterUrl: safeImage(row.poster_url), backdropUrl: safeImage(row.backdrop_url), year: row.release_year == null ? null : Number(row.release_year), genres: array(row.genres), language: String(row.language ?? '') }; }
  async movies({ limit = 48, page = 1, q = '', genre = '', language = '', year }: { limit?: number; page?: number; q?: string; genre?: string; language?: string; year?: number } = {}) {
    const values: unknown[] = []; const where = ['is_published=true'];
    if (q) { values.push(`%${q}%`); where.push(`(title ILIKE $${values.length} OR synopsis ILIKE $${values.length})`); }
    if (genre) { values.push(genre); where.push(`$${values.length}=ANY(genres)`); }
    if (language) { values.push(language); where.push(`LOWER(language)=LOWER($${values.length})`); }
    if (year) { values.push(year); where.push(`release_year=$${values.length}`); }
    values.push(Math.min(Math.max(limit, 1), 100), Math.max(page - 1, 0) * Math.min(Math.max(limit, 1), 100));
    const rows = await this.db.query<ContentRow>(`SELECT * FROM movies WHERE ${where.join(' AND ')} ORDER BY title LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { data: rows.rows.map((row) => this.movie(row)), meta: { count: rows.rowCount ?? 0, page, limit, hasMore: (rows.rowCount ?? 0) === limit } };
  }
  async movieBySlug(slug: string) { const result = await this.db.query<ContentRow>('SELECT * FROM movies WHERE slug=$1 AND is_published=true LIMIT 1', [slug]); return result.rows[0] ? this.movie(result.rows[0]) : null; }
  async seriesList({ limit = 48, page = 1, q = '', genre = '', language = '', year }: { limit?: number; page?: number; q?: string; genre?: string; language?: string; year?: number } = {}) {
    const values: unknown[] = []; const where = ['is_published=true'];
    if (q) { values.push(`%${q}%`); where.push(`(title ILIKE $${values.length} OR synopsis ILIKE $${values.length})`); }
    if (genre) { values.push(genre); where.push(`$${values.length}=ANY(genres)`); }
    if (language) { values.push(language); where.push(`LOWER(language)=LOWER($${values.length})`); }
    if (year) { values.push(year); where.push(`release_year=$${values.length}`); }
    values.push(Math.min(Math.max(limit, 1), 100), Math.max(page - 1, 0) * Math.min(Math.max(limit, 1), 100));
    const rows = await this.db.query<ContentRow>(`SELECT * FROM series WHERE ${where.join(' AND ')} ORDER BY title LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { data: rows.rows.map((row) => this.series(row)), meta: { count: rows.rowCount ?? 0, page, limit, hasMore: (rows.rowCount ?? 0) === limit } };
  }
  async seriesBySlug(slug: string) { const result = await this.db.query<ContentRow>('SELECT * FROM series WHERE slug=$1 AND is_published=true LIMIT 1', [slug]); return result.rows[0] ? this.series(result.rows[0]) : null; }
  async seasons(slug: string) {
    const result = await this.db.query<ContentRow>(`SELECT se.id AS season_id,se.season_number,se.title AS season_title,ep.id AS episode_id,ep.episode_number,ep.title AS episode_title,ep.synopsis,ep.duration_minutes,ep.playback_url,ep.playback_kind FROM series s JOIN seasons se ON se.series_id=s.id LEFT JOIN episodes ep ON ep.season_id=se.id WHERE s.slug=$1 AND s.is_published=true ORDER BY se.season_number,ep.episode_number`, [slug]);
    const seasons = new Map<string, { id: string; seasonNumber: number; title: string; episodes: ContentRow[] }>();
    for (const row of result.rows) {
      const id = String(row.season_id); let season = seasons.get(id);
      if (!season) { season = { id, seasonNumber: Number(row.season_number), title: String(row.season_title || `Season ${row.season_number}`), episodes: [] }; seasons.set(id, season); }
      if (row.episode_id) { const playbackUrl=validatePlaybackUrl(row.playback_url);season.episodes.push({ id: row.episode_id, episodeNumber: row.episode_number, title: row.episode_title, synopsis: row.synopsis, durationMinutes: row.duration_minutes, playbackUrl, playbackKind: playbackUrl ? row.playback_kind : 'unavailable' }); }
    }
    return [...seasons.values()];
  }
  async episode(id: string) {
    const result = await this.db.query<ContentRow>(`SELECT ep.*,se.season_number,se.series_id,s.title AS series_title,s.slug AS series_slug FROM episodes ep JOIN seasons se ON se.id=ep.season_id JOIN series s ON s.id=se.series_id WHERE ep.id=$1 AND s.is_published=true`, [id]);
    const row = result.rows[0]; if (!row) return null;
    const playbackUrl=validatePlaybackUrl(row.playback_url);
    return { id: String(row.id), title: String(row.title), synopsis: String(row.synopsis ?? ''), episodeNumber: Number(row.episode_number), seasonNumber: Number(row.season_number), seriesTitle: String(row.series_title), seriesSlug: String(row.series_slug), durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes), playbackUrl, playbackKind: playbackUrl ? String(row.playback_kind) : 'unavailable' };
  }
  async collections() {
    const result = await this.db.query<ContentRow>(`SELECT c.id,c.title,c.slug,c.description,c.is_featured,ci.content_type,ci.content_id,ci.position FROM collections c LEFT JOIN collection_items ci ON ci.collection_id=c.id WHERE c.is_published=true ORDER BY c.sort_order,ci.position`);
    const collections = new Map<string, ContentRow>();
    for (const row of result.rows) { const id = String(row.id); let value = collections.get(id); if (!value) { value = { id, title: row.title, slug: row.slug, description: row.description, featured: row.is_featured, items: [] }; collections.set(id, value); } if (row.content_id) (value.items as ContentRow[]).push({ type: row.content_type, id: row.content_id, position: Number(row.position) }); }
    return [...collections.values()];
  }
}
