import { AssistantService, compactItem, pickCards } from './assistant.service';
import { RateLimiter } from './assistant.controller';
import { TmdbService } from '../tmdb/tmdb.service';
import { YouTubeFeedService } from '../sports/youtube-feed.service';
import { YouTubeLibraryService } from '../library/youtube-library.service';
import { MediaService } from '../media/media.service';

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
  it('shows no cards when the reply names no title', () => {
    expect(pickCards("I couldn't find anything for SAFF Games 2026.", [movie, series])).toEqual([]);
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
  const media = {
    status: jest.fn(() => ({ images: true, videos: true })),
    image: jest.fn(async () => ({ url: 'https://cdn.example/poster.png', provider: 'agnes', shape: 'poster' })),
    startVideo: jest.fn(async () => ({ id: 'video_1', status: 'queued', progress: 0, url: null })),
  };
  const service = new AssistantService(tmdb, {} as YouTubeFeedService, {} as YouTubeLibraryService, media as unknown as MediaService);
  const reply = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  beforeEach(() => { process.env.OPENROUTER_API_KEY = 'test-key'; process.env.TAVILY_API_KEY = 'tvly-test'; });
  afterEach(() => { delete process.env.OPENROUTER_API_KEY; delete process.env.TAVILY_API_KEY; jest.restoreAllMocks(); });

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

  it('answers current questions through web search with sources', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply({ role: 'assistant', content: null, tool_calls: [{ id: 'w1', type: 'function', function: { name: 'web_search', arguments: '{"query":"Ballon d\'Or 2026 winner"}' } }] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answer: 'X won.', results: [{ title: 'Example News', url: 'https://example.com/news', content: 'X won the award.', published_date: '2026-10-28' }, { title: 'Bad', url: 'javascript:alert(1)', content: '' }] }), { status: 200 }))
      .mockResolvedValueOnce(reply({ role: 'assistant', content: 'X won the 2026 Ballon d\'Or, per [Example News](https://example.com/news).' }));
    const result = await service.chat([{ role: 'user', content: "Who won the Ballon d'Or?" }]);
    expect(result.reply).toContain('[Example News]');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.tavily.com/search');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tvly-test' });
    const search = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as { query: string; include_answer: boolean };
    expect(search).toMatchObject({ query: "Ballon d'Or 2026 winner", include_answer: true });
    const final = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)) as { messages: { role: string; content: string }[] };
    const tool = JSON.parse(final.messages.find((message) => message.role === 'tool')!.content) as { sources: { url: string }[] };
    expect(tool.sources).toEqual([{ title: 'Example News', url: 'https://example.com/news', snippet: 'X won the award.', published: '2026-10-28' }]);
  });

  it('leaves web search out without a Tavily key', async () => {
    delete process.env.TAVILY_API_KEY;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply({ role: 'assistant', content: 'Hello!' }));
    await service.chat([{ role: 'user', content: 'hi' }]);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { tools: { function: { name: string } }[] };
    expect(body.tools.map((tool) => tool.function.name)).not.toContain('web_search');
  });

  it('creates images and videos and returns them as media, not in the text', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply({ role: 'assistant', content: null, tool_calls: [
        { id: 'i1', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":"A neon cyberpunk city poster","shape":"poster"}' } },
        { id: 'v1', type: 'function', function: { name: 'create_video', arguments: '{"prompt":"Rain over a neon city, slow push-in"}' } },
      ] }))
      .mockResolvedValueOnce(reply({ role: 'assistant', content: 'Here is your poster! The clip will appear in a few minutes.' }));
    const result = await service.chat([{ role: 'user', content: 'make a cyberpunk poster and a short clip' }]);
    expect(result.media.images).toEqual([expect.objectContaining({ url: 'https://cdn.example/poster.png' })]);
    expect(result.media.videos).toEqual([expect.objectContaining({ id: 'video_1', status: 'queued' })]);
    expect(media.image).toHaveBeenCalledWith('A neon cyberpunk city poster', 'poster', expect.any(Number));
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as { messages: { role: string; content: string }[] };
    expect(second.messages.filter((message) => message.role === 'tool').map((message) => message.content).join()).not.toContain('cdn.example');
  });

  it('does not offer media tools that are not configured', async () => {
    media.status.mockReturnValueOnce({ images: false, videos: false });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply({ role: 'assistant', content: 'Hi!' }));
    await service.chat([{ role: 'user', content: 'hi' }]);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { tools: { function: { name: string } }[] };
    expect(body.tools.map((tool) => tool.function.name)).not.toEqual(expect.arrayContaining(['generate_image']));
    expect(body.tools.map((tool) => tool.function.name)).not.toEqual(expect.arrayContaining(['create_video']));
  });

  it('reports a clear error when OpenRouter fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 502 }));
    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('busy');
  });

  it('reports what is switched on without secrets', () => {
    expect(service.status()).toEqual({ configured: true, model: 'deepseek/deepseek-v4-flash', webSearch: true });
    expect(JSON.stringify(service.status())).not.toContain('tvly-test');
  });

  it('is unavailable without a key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('not configured');
  });
});
