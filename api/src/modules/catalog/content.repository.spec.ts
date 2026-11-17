import { ContentRepository } from './content.repository';
import { PostgresService } from '../database/postgres.service';

describe('ContentRepository', () => {
  const rows = [{
    id: 'movie-id',
    slug: 'sample-movie',
    title: 'Sample movie',
    synopsis: 'A catalog record',
    poster_url: 'http://unsafe.example/poster.jpg',
    backdrop_url: 'https://images.example/backdrop.jpg',
    release_year: 2025,
    genres: ['Drama'],
    language: 'English',
    duration_minutes: 95,
    playback_url: 'https://unapproved.example/movie.m3u8',
    playback_kind: 'hls',
  }];

  afterEach(() => { delete process.env.PLAYBACK_ALLOWED_HOSTS; });

  it('uses parameterized filters and rejects unapproved media and artwork URLs', async () => {
    process.env.PLAYBACK_ALLOWED_HOSTS = 'cdn.operator.example';
    const db = { query: jest.fn().mockResolvedValue({ rows, rowCount: 1 }) } as unknown as PostgresService;
    const repository = new ContentRepository(db);

    const result = await repository.movies({ page: 2, limit: 10, q: 'Sample', genre: 'Drama', language: 'English', year: 2025 });

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), [
      '%Sample%', 'Drama', 'English', 2025, 10, 10,
    ]);
    expect(result.data[0]).toMatchObject({
      id: 'movie-id',
      title: 'Sample movie',
      posterUrl: null,
      backdropUrl: 'https://images.example/backdrop.jpg',
      playbackUrl: null,
      playbackKind: 'unavailable',
    });
  });
});
