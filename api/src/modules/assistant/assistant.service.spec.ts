import { AssistantService, compactItem, pickCards } from './assistant.service';
import { RateLimiter } from './assistant.controller';
import { TmdbService } from '../tmdb/tmdb.service';
import { YouTubeFeedService } from '../sports/youtube-feed.service';
import { YouTubeLibraryService } from '../library/youtube-library.service';

const movie = { id: 'tmdb-movie-550', slug: 'tmdb-550', tmdbId: 550, title: 'Fight Club', name: 'Fight Club', type: 'movie', year: 1999, rating: 8.4, genres: ['Drama'], synopsis: 'An insomniac office worker...', playbackUrl: 'https://embed.example/x' };
const series = { id: 'tmdb-tv-1', slug: 'tmdb-1', tmdbId: 1, title: 'Crash Landing on You', name: 'Crash Landing on You', type: 'series', year: 2019, genres: ['Drama'], synopsis: 'A paragliding mishap...' };

describe('compactItem', () => {
  it('keeps what the model needs and drops URLs', () => {
    const compact = compactItem(movie);
    expect(compact).toMatchObject({ title: 'Fight Club', type: 'movie', tmdbId: 550, year: 1999, rating: 8.4 });
    expect(JSON.stringify(compact)).not.toContain('https://');
  });
});

describe('pickCards', () => {
  it('returns the titles the reply names, without duplicates', () => {
    expect(pickCards('Try Crash Landing on You tonight.', [movie, series, series]).map((item) => item.id)).toEqual(['tmdb-tv-1']);
  });
  it('falls back to the first results when no title is named', () => {
    expect(pickCards('Here is what is trending.', [movie, series])).toHaveLength(2);
  });
});

describe('RateLimiter', () => {
  it('allows a fixed number of requests per window per address', () => {
    const limiter = new RateLimiter(2, 1000);
    expect([limiter.allow('a', 0), limiter.allow('a', 1), limiter.allow('a', 2), limiter.allow('b', 2), limiter.allow('a', 1500)]).toEqual([true, true, false, true, true]);
  });
});

describe('AssistantService.chat', () => {
  const tmdb = { searchMovies: jest.fn(async () => [movie]), searchSeries: jest.fn(async () => []) } as unknown as TmdbService;
  const service = new AssistantService(tmdb, {} as YouTubeFeedService, {} as YouTubeLibraryService);
  const reply = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  beforeEach(() => { process.env.OPENROUTER_API_KEY = 'test-key'; });
  afterEach(() => { delete process.env.OPENROUTER_API_KEY; jest.restoreAllMocks(); });

  it('runs the tool the model asks for and returns the reply with cards', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_titles', arguments: '{"query":"fight club","kind":"movie"}' } }] }))
      .mockResolvedValueOnce(reply({ role: 'assistant', content: 'Fight Club (1999) is rated 8.4.' }));
    const result = await service.chat([{ role: 'user', content: 'Tell me about Fight Club' }], 'us');
    expect(result.reply).toBe('Fight Club (1999) is rated 8.4.');
    expect(result.items.map((item) => item.id)).toEqual(['tmdb-movie-550']);
    expect(tmdb.searchMovies).toHaveBeenCalledWith('fight club');
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as { messages: { role: string; content: string }[] };
    const toolMessage = second.messages.find((message) => message.role === 'tool')!;
    expect(toolMessage.content).toContain('Fight Club');
    expect(toolMessage.content).not.toContain('embed.example');
    expect(second.messages[0].content).toContain('country is US');
  });

  it('saves memories the model asks for and passes stored memory to the model', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply({ role: 'assistant', content: null, tool_calls: [{ id: 'm1', type: 'function', function: { name: 'save_memory', arguments: '{"fact":"Loves Korean romance dramas"}' } }] }))
      .mockResolvedValueOnce(reply({ role: 'assistant', content: 'Got it, I will remember that.' }));
    const result = await service.chat([{ role: 'user', content: 'I love Korean romance dramas' }], 'BD', ['Supports Barcelona']);
    expect(result.remembered).toEqual(['Loves Korean romance dramas']);
    const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { messages: { content: string }[] };
    expect(first.messages[0].content).toContain('- Supports Barcelona');
  });

  it('reports a clear error when OpenRouter fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 502 }));
    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('busy');
  });

  it('is unavailable without a key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('not configured');
  });
});
