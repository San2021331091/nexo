import { checkPrompt, MediaService, parseVideoJob } from './media.service';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

describe('checkPrompt', () => {
  it('accepts normal descriptions and trims whitespace', () => {
    expect(checkPrompt('  A  cinematic poster of a lighthouse  ')).toBe('A cinematic poster of a lighthouse');
  });
  it('rejects empty, oversized and explicit requests', () => {
    expect(() => checkPrompt('')).toThrow('Describe');
    expect(() => checkPrompt('x'.repeat(801))).toThrow('too long');
    expect(() => checkPrompt('a nude portrait')).toThrow('not allowed');
  });
});

describe('parseVideoJob', () => {
  it('maps queued, running, done and failed states', () => {
    expect(parseVideoJob('v', { status: 'queued', progress: 0 })).toMatchObject({ status: 'queued' });
    expect(parseVideoJob('v', { status: 'in_progress', progress: 40 })).toMatchObject({ status: 'running', progress: 40 });
    expect(parseVideoJob('v', { status: 'completed', video_url: 'https://cdn.example/v.mp4' })).toEqual({ id: 'v', status: 'done', progress: 100, url: 'https://cdn.example/v.mp4' });
    expect(parseVideoJob('v', { status: 'completed', remixed_from_video_id: 'https://cdn.example/r.mp4' })).toMatchObject({ status: 'done', url: 'https://cdn.example/r.mp4' });
    expect(parseVideoJob('v', { status: 'failed', error: { message: 'division by zero' } })).toMatchObject({ status: 'failed', error: 'division by zero' });
  });
  it('treats a finished job without an HTTPS file as failed', () => {
    expect(parseVideoJob('v', { status: 'completed', url: 'http://insecure.example/v.mp4' })).toMatchObject({ status: 'failed' });
  });
});

describe('MediaService', () => {
  const env = ['AGNES_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
  afterEach(() => { for (const name of env) delete process.env[name]; jest.restoreAllMocks(); });

  it('makes a poster with Agnes at a 2:3 size', async () => {
    process.env.AGNES_API_KEY = 'sk-test';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(json({ data: [{ url: 'https://platform-outputs.agnes-ai.space/images/a.png' }] }));
    await expect(new MediaService().image('A lighthouse poster', 'poster')).resolves.toEqual({ url: 'https://platform-outputs.agnes-ai.space/images/a.png', provider: 'agnes', shape: 'poster' });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'agnes-image-2.5-flash', size: '768x1152', extra_body: { response_format: 'url' } });
  });

  it('falls back to Cloudflare FLUX when Agnes fails', async () => {
    process.env.AGNES_API_KEY = 'sk-test';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32);
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(json({ error: 'busy' }, 503))
      .mockResolvedValueOnce(json({ result: { image: 'A'.repeat(200) }, success: true }));
    const image = await new MediaService().image('A lighthouse', 'wide');
    expect(image).toMatchObject({ provider: 'cloudflare', shape: 'square' });
    expect(image.url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/@cf/black-forest-labs/flux-1-schnell`);
  });

  it('is unavailable with no provider configured', async () => {
    expect(new MediaService().status()).toMatchObject({ images: false, videos: false });
    await expect(new MediaService().image('A lighthouse')).rejects.toThrow('not configured');
  });

  it('starts a text-to-video job and reports a busy queue clearly', async () => {
    process.env.AGNES_API_KEY = 'sk-test';
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(json({ video_id: 'video_abc123', status: 'queued', progress: 0 }))
      .mockResolvedValueOnce(json({ code: 'video_queue_full', message: 'video queue is full' }, 400));
    const service = new MediaService();
    await expect(service.startVideo('Rain over a neon city')).resolves.toMatchObject({ id: 'video_abc123', status: 'queued' });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ model: 'agnes-video-2.5-flash', mode: 'text', prompt: 'Rain over a neon city' });
    await expect(service.startVideo('Rain over a neon city')).rejects.toThrow('busy');
  });

  it('polls new and old style video ids at the right endpoint', async () => {
    process.env.AGNES_API_KEY = 'sk-test';
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(json({ status: 'completed', video_url: 'https://cdn.example/v.mp4' }))
      .mockResolvedValueOnce(json({ status: 'in_progress', progress: 50 }));
    const service = new MediaService();
    await expect(service.video('video_abc123')).resolves.toMatchObject({ status: 'done', url: 'https://cdn.example/v.mp4' });
    await expect(service.video('task_xyz789')).resolves.toMatchObject({ status: 'running', progress: 50 });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://apihub.agnes-ai.com/agnesapi?video_id=video_abc123');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://apihub.agnes-ai.com/v1/videos/task_xyz789');
    await expect(service.video('../etc')).rejects.toThrow('Unknown video');
  });
});
