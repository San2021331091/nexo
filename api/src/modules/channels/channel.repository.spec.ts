import { ChannelRepository } from './channel.repository';
import { PostgresService } from '../database/postgres.service';

describe('ChannelRepository existing Neon schema mapping', () => {
  const channelColumns = ['id', 'cname', 'description', 'liveurl', 'imgurl', 'fburl', 'twurl', 'youtubeurl', 'website', 'category'].map((column_name, index) => ({ column_name, data_type: index === 0 ? 'character varying' : 'text', is_nullable: 'NO', column_default: null, ordinal_position: index + 1 }));
  const categoryColumns = ['id', 'category', 'cgurl'].map((column_name, index) => ({ column_name, data_type: 'character varying', is_nullable: 'NO', column_default: null, ordinal_position: index + 1 }));
  const query = jest.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('information_schema.columns')) return { rows: values[0] === 'categorydb' ? categoryColumns : channelColumns };
    if (sql.includes('information_schema.table_constraints')) return { rows: [] };
    if (sql.includes('information_schema.tables')) return { rows: [{ table_name: sql.includes("lower('categorydb')") ? 'categorydb' : 'channeltb' }] };
    if (sql.includes('FROM "categorydb"')) return { rows: [{ id: 'cat-1', category: 'News', cgurl: 'https://images.example/news.png' }] };
    if (sql.includes('FROM "channeltb"')) return { rows: [{ id: 'tv-1', cname: 'News One', description: 'Official news channel', liveurl: 'https://stream.operator.example/live.m3u8', imgurl: 'https://images.example/news-one.png', fburl: '', twurl: '', youtubeurl: '', website: '', category: 'News' }] };
    return { rows: [] };
  });

  beforeEach(() => { query.mockClear(); process.env.PLAYBACK_ALLOWED_HOSTS = 'stream.operator.example'; });
  afterAll(() => { delete process.env.PLAYBACK_ALLOWED_HOSTS; });

  it('reads and maps the existing cname/liveurl/imgurl/category columns', async () => {
    const repository = new ChannelRepository({ query } as unknown as PostgresService);
    await expect(repository.list()).resolves.toEqual([expect.objectContaining({ id: 'tv-1', name: 'News One', category: 'News', playbackUrl: 'https://stream.operator.example/live.m3u8', playbackKind: 'hls', type: 'channel', logoUrl: 'https://images.example/news-one.png', supportsActive: false })]);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE') || String(sql).startsWith('INSERT'))).toBe(false);
  });

  it('keeps stored stream URLs playable when no host allowlist is configured', async () => {
    delete process.env.PLAYBACK_ALLOWED_HOSTS;
    const repository = new ChannelRepository({ query } as unknown as PostgresService);
    await expect(repository.list()).resolves.toEqual([expect.objectContaining({ playbackUrl: 'https://stream.operator.example/live.m3u8', playbackKind: 'hls' })]);
  });

  it('hides stream URLs outside a configured allowlist', async () => {
    process.env.PLAYBACK_ALLOWED_HOSTS = 'other.example';
    const repository = new ChannelRepository({ query } as unknown as PostgresService);
    await expect(repository.list()).resolves.toEqual([expect.objectContaining({ playbackUrl: null, playbackKind: 'unavailable' })]);
  });

  it('searches channel names, descriptions and category names', async () => {
    const repository = new ChannelRepository({ query } as unknown as PostgresService);
    await repository.list(48, 'news');
    const call = query.mock.calls.find(([sql]) => sql.includes('FROM "channeltb"'))!;
    expect(call[0]).toContain(`"cname" ILIKE $1 OR COALESCE("description"::text, '') ILIKE $1 OR "category"::text = ANY($2)`);
    expect(call[1]).toEqual(expect.arrayContaining(['%news%', ['cat-1', 'News']]));
  });
});
