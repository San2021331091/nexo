import { Injectable } from '@nestjs/common';
import { PostgresService } from '../database/postgres.service';
import { Channel, DbColumn, DbConstraint, TableShape } from './channel.types';
import { playbackKindFor, validatePlaybackUrl } from '../playback/url-validator';

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const choose = (columns: DbColumn[], aliases: string[]) => columns.find((column) => aliases.includes(column.column_name.toLowerCase()))?.column_name;
// Some existing rows store a literal "" for blank text fields.
const text = (value: unknown): string | null => { const cleaned = typeof value === 'string' ? value.trim() : ''; return cleaned && cleaned !== '""' ? cleaned : null; };
const SHAPE_TTL = 60_000;
export const MAX_CHANNELS = 1000;
const safeImageUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; }
};

@Injectable()
export class ChannelRepository {
  private readonly shapes = new Map<string, { expires: number; shape: TableShape }>();
  constructor(private readonly db: PostgresService) {}
  private async inspectTable(table: string): Promise<TableShape> {
    const cached = this.shapes.get(table);
    if (cached && cached.expires > Date.now()) return cached.shape;
    const shape = await this.readTableShape(table);
    if (shape.columns.length) this.shapes.set(table, { expires: Date.now() + SHAPE_TTL, shape });
    return shape;
  }
  private async readTableShape(table: string): Promise<TableShape> {
    const cols = await this.db.query<DbColumn>(`SELECT column_name, data_type, is_nullable, column_default, ordinal_position FROM information_schema.columns WHERE table_schema = current_schema() AND lower(table_name) = lower($1) ORDER BY ordinal_position`, [table]);
    const cons = await this.db.query<DbConstraint>(`SELECT tc.constraint_name, tc.constraint_type, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema WHERE tc.table_schema=current_schema() AND lower(tc.table_name)=lower($1)`, [table]);
    return { columns: cols.rows, constraints: cons.rows };
  }
  async schema() { return { channels: await this.inspectTable('channeltb'), categories: await this.inspectTable('categorydb') }; }
  async count() {
    const table = await this.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND lower(table_name)=lower('channeltb') LIMIT 1`);
    if (!table.rows[0]) return 0;
    const result = await this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quote(table.rows[0].table_name)}`);
    return Number(result.rows[0]?.count ?? 0);
  }
  async categories() {
    const shape = await this.inspectTable('categorydb');
    if (!shape.columns.length) return [];
    const id = choose(shape.columns, ['id', 'category_id', 'categoryid']);
    const name = choose(shape.columns, ['name', 'category_name', 'categoryname', 'title', 'category']);
    const image = choose(shape.columns, ['cgurl', 'image_url', 'logo_url']);
    const actual = await this.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND lower(table_name)=lower('categorydb') LIMIT 1`);
    if (!actual.rows[0]) return [];
    const rows = await this.db.query(`SELECT * FROM ${quote(actual.rows[0].table_name)} LIMIT 250`);
    return rows.rows.slice(0, 250).map((row, index) => ({ id: String((id && row[id]) ?? index), name: String((name && row[name]) ?? Object.values(row).find((v) => typeof v === 'string') ?? 'Category'), imageUrl: safeImageUrl(image && row[image]) }));
  }
  async list(limit = 48, search = '', category = '', offset = 0): Promise<Channel[]> {
    const shape = await this.inspectTable('channeltb');
    if (!shape.columns.length) return [];
    const actualTable = await this.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND lower(table_name)=lower('channeltb') LIMIT 1`);
    const table = actualTable.rows[0]?.table_name;
    if (!table) return [];
    const nameCol = choose(shape.columns, ['name', 'cname', 'channel_name', 'channelname', 'title', 'channel_title', 'channel_title_name']);
    const idCol = choose(shape.columns, ['id', 'channel_id', 'channelid']);
    const catCol = choose(shape.columns, ['category_id', 'categoryid', 'category', 'category_name', 'categoryname']);
    const logoCol = choose(shape.columns, ['logo', 'logo_url', 'logourl', 'imgurl', 'image', 'image_url', 'icon']);
    const playbackCol = choose(shape.columns, ['stream_url', 'streamurl', 'playback_url', 'playbackurl', 'liveurl', 'url', 'video_url']);
    const slugCol = choose(shape.columns, ['slug', 'channel_slug']);
    const activeCol = choose(shape.columns, ['is_active', 'active', 'enabled']);
    const descriptionCol = choose(shape.columns, ['description', 'synopsis']);
    const websiteCol = choose(shape.columns, ['website', 'website_url']);
    const fbCol = choose(shape.columns, ['fburl', 'facebook_url']);
    const twCol = choose(shape.columns, ['twurl', 'twitter_url']);
    const ytCol = choose(shape.columns, ['youtubeurl', 'youtube_url']);
    const where: string[] = [];
    const params: unknown[] = [];
    if (nameCol && search.trim()) {
      const term = search.trim();
      params.push(`%${term}%`);
      const any = [`${quote(nameCol)} ILIKE $${params.length}`];
      if (descriptionCol) any.push(`COALESCE(${quote(descriptionCol)}::text, '') ILIKE $${params.length}`);
      // "sports", "news", "bangladesh": channels whose category name contains the term.
      if (catCol) {
        const categories = (await this.categories()).filter((item) => item.name.toLowerCase().includes(term.toLowerCase()));
        if (categories.length) { params.push(categories.flatMap((item) => [item.id, item.name])); any.push(`${quote(catCol)}::text = ANY($${params.length})`); }
      }
      where.push(`(${any.join(' OR ')})`);
    }
    if (catCol && category.trim()) { const match = (await this.categories()).find((item) => item.name.toLowerCase() === category.trim().toLowerCase()); params.push(match?.name ?? category.trim()); where.push(`${quote(catCol)}::text ILIKE $${params.length}`); }
    if (activeCol) where.push(`COALESCE(${quote(activeCol)}::text, 'true') NOT IN ('false', '0', 'inactive', 'disabled')`);
    const safeLimit = Math.min(Math.max(limit, 1), MAX_CHANNELS);
    params.push(safeLimit, Math.max(0, offset));
    const result = await this.db.query<Record<string, unknown>>(`SELECT * FROM ${quote(table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${nameCol ? quote(nameCol) : '1'} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const cats = await this.categories();
    return result.rows.map((row, index) => {
      const name = String((nameCol && row[nameCol]) ?? `Channel ${index + 1}`);
      const categoryValue = String((catCol && row[catCol]) ?? 'Live TV');
      const category = cats.find((item) => item.name.toLowerCase() === categoryValue.toLowerCase())?.name ?? categoryValue;
      const activeValue = activeCol ? String(row[activeCol]).toLowerCase() : 'true';
      const playbackUrl = validatePlaybackUrl(playbackCol && row[playbackCol]);
      return { id: String((idCol && row[idCol]) ?? index), slug: String((slugCol && row[slugCol]) ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')), name, category, logoUrl: safeImageUrl(logoCol && row[logoCol]), type: 'channel' as const, playbackUrl, playbackKind: playbackUrl ? playbackKindFor(playbackUrl) : 'unavailable' as const, description: text(descriptionCol && row[descriptionCol]), website: text(websiteCol && row[websiteCol]), fbUrl: text(fbCol && row[fbCol]), twUrl: text(twCol && row[twCol]), youtubeUrl: text(ytCol && row[ytCol]), isLive: true, active: !['false', '0', 'inactive', 'disabled'].includes(activeValue), supportsActive: Boolean(activeCol) };
    });
  }
  async bySlug(slug: string) { return (await this.list(MAX_CHANNELS)).find((item) => item.slug === slug) ?? null; }
}
