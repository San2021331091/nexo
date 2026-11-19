import { isFullLength, libraryChannels, YouTubeLibraryService } from './youtube-library.service';
import { PostgresService } from '../database/postgres.service';

describe('isFullLength', () => {
  // Real upload titles from the default channels' feeds (November 2026).
  it('keeps full drama and web series episodes', () => {
    for (const title of [
      'Komolika Learns Anurag Still Loves Prerna | Full Ep. 144 | Kasautii Zindagi Kay',
      'Sachin Fumes Over Renuka’s Room Plan | Full Ep. 232 | Udne Ki Aasha',
      '金庸武俠經典射鵰英雄傳｜TVB Drama  4K 60FPS 31 & 32/35｜朱茵 張智霖 羅嘉良｜TVB  國語中字',
      '心如成熟時（上）   愛回家之開心速遞 4K 60fps 第620集   TVB Drama',
      '2026 female-led revenge dramas❤️‍🔥ENGSUB【Where the Mask Ends】EP17 Lu Zhuo begs her to stay 💘',
      'ENGSUB【Notes of DNA Appraiser】EP28 | Secret Meeting Exposed 🫨 | YOUKU',
      'مسلسل الحفرة4| الحلقة 43| ثريا تسلم يامان الأوراق',
      'Pawnadar | Live Natok | Mosharraf Karim | Tanha Tasnia | Bangla Natok',
    ]) expect([title, isFullLength('dramas', title)]).toEqual([title, true]);
  });

  it('drops promos, teasers, clips, best scenes and Shorts', () => {
    for (const title of [
      'Gulbahar - Episode 19 Promo - Tonight At 09 Pm On Youtube [Sanam Saeed & Komal Meer] HUM TV',
      'Mohabbat Episode 12 | 𝐁𝐞𝐬𝐭 𝐒𝐜𝐞𝐧𝐞 𝟎𝟒 | Feroze Khan - Saniya Shamshad | HAR PAL GEO',
      'Bano Episode 35 New Teaser #bano #shorts #teaser',
      '【TRAILER】EP43-44: She turns to Ziqi for a DNA test that could change her life! 🥺 | YOUKU',
      'ENG DUB|Clip21-23🌙【When I Meet the Moon|折月亮】He Gets a Cat🐱|iQIYI English',
      'Tumm Se Tumm Tak | EP - 493 | Best Scene 2 | Nov 15 2026 | Zee TV',
      'Lakshmi Nivas | Ep - 306 | Reel | Nov 17 2026 | Zee TV',
      'Kya Hurmat Ko Eik Aur Mauqa Milay Ga?? #hurmatdrama #dananeermubeen',
    ]) expect([title, isFullLength('dramas', title)]).toEqual([title, false]);
  });

  it('keeps full movies and drops movie scenes', () => {
    expect(isFullLength('movies', 'Zeenat Aman & Vinod Khanna Superhit Action Film | Daulat (1982) Full Hindi Movie | Raj Babbar')).toBe(true);
    expect(isFullLength('movies', 'Raanjhanaa Full Movie | Dhanush, Sonam Kapoor | Bollywood Superhit Romantic Movie')).toBe(true);
    expect(isFullLength('movies', '【Multi-Sub】The Deadlines | Thriller/Suspense/Adventure | Chinese movie 2026 | iQIYI English')).toBe(true);
    expect(isFullLength('movies', 'Zeenat Aman Aur Amitabh Bachchan Ka Classic Romantic Scene | Pukar (1983) Best Scene')).toBe(false);
    expect(isFullLength('movies', 'देवी ने उसका बदला ले लिया | Naag Bhoomi Movie Thriller Climax')).toBe(false);
  });
});

describe('libraryChannels', () => {
  afterEach(() => { delete process.env.DRAMAS_FULL_YOUTUBE_CHANNELS; });
  it('uses the defaults, an override list, or nothing when off', () => {
    expect(libraryChannels('dramas').length).toBeGreaterThan(0);
    process.env.DRAMAS_FULL_YOUTUBE_CHANNELS = 'UCEeEQxm6qc_qaTE7qTV5aLQ, not-an-id';
    expect(libraryChannels('dramas')).toEqual(['UCEeEQxm6qc_qaTE7qTV5aLQ']);
    process.env.DRAMAS_FULL_YOUTUBE_CHANNELS = 'off';
    expect(libraryChannels('dramas')).toEqual([]);
  });
});

describe('YouTubeLibraryService.sync', () => {
  const feed = (title: string, entries: [string, string][]) => `<feed><title>${title}</title>${entries.map(([id, name]) => `<entry><yt:videoId>${id}</yt:videoId><title>${name}</title><published>2026-11-17T10:00:00+00:00</published><link href="https://www.youtube.com/watch?v=${id}"/></entry>`).join('')}</feed>`;
  const env = ['MOVIES_FULL_YOUTUBE_CHANNELS', 'SERIES_FULL_YOUTUBE_CHANNELS', 'DRAMAS_FULL_YOUTUBE_CHANNELS'];
  afterEach(() => { for (const name of env) delete process.env[name]; delete process.env.YOUTUBE_API_KEY; jest.restoreAllMocks(); });

  it('stores only full length uploads and reads them back newest first', async () => {
    process.env.MOVIES_FULL_YOUTUBE_CHANNELS = 'off';
    process.env.SERIES_FULL_YOUTUBE_CHANNELS = 'off';
    process.env.DRAMAS_FULL_YOUTUBE_CHANNELS = 'UC-LPIU24bQXVljUXivKEeRQ';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(feed('StarPlus', [['aaaaaaaaaaa', 'Raj Face a Dangerous Encounter | Full Ep. 141 | Sasural Genda Phool'], ['bbbbbbbbbbb', 'Kumkum Promo | StarPlus']])));
    const queries: { sql: string; values: unknown[] }[] = [];
    const db = { query: jest.fn(async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      if (sql.startsWith('INSERT')) return { rows: [{ inserted: true }], rowCount: 1 };
      if (sql.startsWith('SELECT video_id')) return { rows: [{ video_id: 'aaaaaaaaaaa', channel_title: 'StarPlus', title: 'Full Ep. 141', published_at: '2026-11-17T10:00:00Z' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) } as unknown as PostgresService;
    const service = new YouTubeLibraryService(db);

    const result = await service.sync();
    expect(result).toMatchObject({ channels: 1, seen: 2, added: 1, failed: 0 });
    const inserts = queries.filter((query) => query.sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values.slice(0, 4)).toEqual(['aaaaaaaaaaa', 'dramas', 'UC-LPIU24bQXVljUXivKEeRQ', 'StarPlus']);

    const latest = await service.latest('dramas');
    expect(latest).toEqual([expect.objectContaining({ id: 'yt-aaaaaaaaaaa', playbackUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', playbackKind: 'youtube', category: 'StarPlus' })]);
  });

  it('counts a failing channel and keeps going', async () => {
    process.env.MOVIES_FULL_YOUTUBE_CHANNELS = 'off';
    process.env.SERIES_FULL_YOUTUBE_CHANNELS = 'off';
    process.env.DRAMAS_FULL_YOUTUBE_CHANNELS = 'UC-LPIU24bQXVljUXivKEeRQ';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const db = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as PostgresService;
    expect(await new YouTubeLibraryService(db).sync()).toMatchObject({ channels: 1, added: 0, failed: 1 });
  });

  it('searches stored titles and channels word by word, tagged with the group', async () => {
    const queries: { sql: string; values: unknown[] }[] = [];
    const db = { query: jest.fn(async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      return sql.startsWith('SELECT video_id, grp') ? { rows: [{ video_id: 'aaaaaaaaaaa', grp: 'dramas', channel_title: 'HUM TV', title: 'Gulbahar Episode 19', published_at: '2026-11-17T10:00:00Z' }, { video_id: 'aaaaaaaaaaa', grp: 'series', channel_title: 'HUM TV', title: 'Gulbahar Episode 19', published_at: '2026-11-17T10:00:00Z' }] } : { rows: [] };
    }) } as unknown as PostgresService;
    const results = await new YouTubeLibraryService(db).search('gulbahar 100%');
    expect(results).toEqual([expect.objectContaining({ id: 'yt-aaaaaaaaaaa', section: 'dramas', playbackKind: 'youtube' })]);
    const search = queries.find((query) => query.sql.startsWith('SELECT video_id, grp'))!;
    expect(search.values).toEqual(['%gulbahar%', String.raw`%100\%%`, 20]);
  });
});
