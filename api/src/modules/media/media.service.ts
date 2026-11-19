import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

// AI image and video generation for NEXO: posters, thumbnails, wallpapers and
// short clips made from a description. Agnes (AGNES_API_KEY) makes images and
// videos; Cloudflare Workers AI FLUX (CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID) makes images when Agnes is missing or fails.
const AGNES = 'https://apihub.agnes-ai.com';
const DEFAULT_IMAGE_MODEL = 'agnes-image-2.5-flash';
const DEFAULT_VIDEO_MODEL = 'agnes-video-2.5-flash';
const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export type ImageShape = 'poster' | 'wide' | 'square';
const SIZES: Record<ImageShape, string> = { poster: '768x1152', wide: '1280x720', square: '1024x1024' };

export interface GeneratedImage { url: string; provider: 'agnes' | 'cloudflare'; shape: ImageShape }
export type VideoState = 'queued' | 'running' | 'done' | 'failed';
export interface VideoJob { id: string; status: VideoState; progress: number; url: string | null; error?: string }

// Requests the generators must never be asked for. The models have their own
// filters; this stops the obvious cases before any request is made.
const BLOCKED = /\b(nude|nudity|naked|nsfw|porn\w*|sex(ual|y)?|erotic|explicit|topless|undress\w*|fetish|gore|beheading|child\s*abuse|loli|underage)\b/i;

/** Rejects empty, oversized or disallowed prompts. Exported for tests. */
export function checkPrompt(value: unknown): string {
  const prompt = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (prompt.length < 3) throw new BadRequestException('Describe what to create.');
  if (prompt.length > 800) throw new BadRequestException('The description is too long (800 characters at most).');
  if (BLOCKED.test(prompt)) throw new BadRequestException('That request is not allowed. NEXO creates family friendly artwork only.');
  return prompt;
}

const httpsUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null; } catch { return null; }
};

/** The video job state from an Agnes task response, whatever its exact shape. Exported for tests. */
export function parseVideoJob(id: string, body: Record<string, unknown>): VideoJob {
  const raw = String(body.status ?? '').toLowerCase();
  const nested = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
  const url = [body.video_url, body.url, nested.video_url, nested.url, body.remixed_from_video_id, (body.output as Record<string, unknown> | undefined)?.url]
    .map(httpsUrl).find(Boolean) ?? null;
  const progress = Math.max(0, Math.min(100, Number(body.progress ?? nested.progress ?? 0) || 0));
  const error = body.error ? (typeof body.error === 'string' ? body.error : String((body.error as Record<string, unknown>).message ?? 'failed')) : undefined;
  if (error || ['failed', 'error', 'cancelled', 'canceled'].includes(raw)) return { id, status: 'failed', progress, url: null, error: error ?? 'The video could not be made.' };
  if (['completed', 'succeeded', 'success', 'done'].includes(raw)) return url ? { id, status: 'done', progress: 100, url } : { id, status: 'failed', progress, url: null, error: 'The video finished without a file.' };
  return { id, status: raw === 'queued' || raw === 'pending' || raw === '' ? 'queued' : 'running', progress, url: null };
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  private get agnesKey() { return process.env.AGNES_API_KEY?.trim() || ''; }
  private get cloudflare() {
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim() || '';
    const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || '';
    return token && /^[a-f0-9]{32}$/i.test(account) ? { token, account } : null;
  }

  /** What can be generated, without secrets. */
  status() {
    return { images: Boolean(this.agnesKey || this.cloudflare), videos: Boolean(this.agnesKey), providers: { agnes: Boolean(this.agnesKey), cloudflare: Boolean(this.cloudflare) } };
  }

  /** One image for a description. Tries Agnes, then Cloudflare FLUX. */
  async image(rawPrompt: unknown, shape: ImageShape = 'poster', timeoutMs = 45_000): Promise<GeneratedImage> {
    const prompt = checkPrompt(rawPrompt);
    if (!this.status().images) throw new ServiceUnavailableException('Image generation is not configured.');
    const deadline = Date.now() + timeoutMs;
    if (this.agnesKey) {
      try { return await this.agnesImage(prompt, shape, deadline); } catch (error) { this.logger.warn(`Agnes image failed: ${error instanceof Error ? error.message : 'error'}`); }
    }
    if (this.cloudflare && deadline - Date.now() > 3_000) {
      try { return await this.cloudflareImage(prompt, shape, deadline); } catch (error) { this.logger.warn(`Cloudflare image failed: ${error instanceof Error ? error.message : 'error'}`); }
    }
    throw new ServiceUnavailableException('The image could not be created right now. Please try again.');
  }

  private async agnesImage(prompt: string, shape: ImageShape, deadline: number): Promise<GeneratedImage> {
    const response = await fetch(`${AGNES}/v1/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.agnesKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.AGNES_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL, prompt, size: SIZES[shape], extra_body: { response_format: 'url' } }),
      signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { data?: { url?: string }[] };
    const url = httpsUrl(body.data?.[0]?.url);
    if (!url) throw new Error('no image URL');
    return { url, provider: 'agnes', shape };
  }

  private async cloudflareImage(prompt: string, shape: ImageShape, deadline: number): Promise<GeneratedImage> {
    // The framing hint keeps the subject placed for the shape that was asked for.
    const { token, account } = this.cloudflare!;
    const framing = shape === 'poster' ? 'vertical poster composition' : shape === 'wide' ? 'wide 16:9 composition' : 'square composition';
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `${prompt}, ${framing}`, steps: 6 }),
      signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { result?: { image?: string } };
    const image = body.result?.image ?? '';
    if (!/^[A-Za-z0-9+/=]{100,}$/.test(image)) throw new Error('no image data');
    // FLUX schnell always returns a 1024x1024 image, whatever shape was asked for.
    return { url: `data:image/jpeg;base64,${image}`, provider: 'cloudflare', shape: 'square' };
  }

  /** Starts a short text-to-video clip. The app polls [video] until it is done. */
  async startVideo(rawPrompt: unknown): Promise<VideoJob> {
    const prompt = checkPrompt(rawPrompt);
    if (!this.agnesKey) throw new ServiceUnavailableException('Video generation is not configured.');
    let response: Response;
    try {
      response = await fetch(`${AGNES}/v1/videos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.agnesKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.AGNES_VIDEO_MODEL?.trim() || DEFAULT_VIDEO_MODEL, mode: 'text', prompt }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      this.logger.warn(`Agnes video start failed: ${error instanceof Error ? error.message : 'error'}`);
      throw new ServiceUnavailableException('The video service did not answer. Please try again.');
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.code === 'video_queue_full' || response.status === 429 || response.status === 503) throw new HttpException('The video studio is busy right now. Please try again in a few minutes.', HttpStatus.SERVICE_UNAVAILABLE);
    if (!response.ok) { this.logger.warn(`Agnes video start responded ${response.status}: ${String(body.message ?? '').slice(0, 200)}`); throw new ServiceUnavailableException('The video could not be started right now.'); }
    const id = [body.video_id, body.task_id, body.id].find((value) => typeof value === 'string' && /^[\w-]{4,100}$/.test(value)) as string | undefined;
    if (!id) throw new ServiceUnavailableException('The video service returned no job.');
    return parseVideoJob(id, body);
  }

  /** The current state of a video job. */
  async video(id: string): Promise<VideoJob> {
    if (!/^[\w-]{4,100}$/.test(id)) throw new BadRequestException('Unknown video.');
    if (!this.agnesKey) throw new ServiceUnavailableException('Video generation is not configured.');
    // Newer jobs (video_…) are read from /agnesapi; older task ids from /v1/videos/{id}.
    const url = id.startsWith('video_') ? `${AGNES}/agnesapi?video_id=${encodeURIComponent(id)}` : `${AGNES}/v1/videos/${encodeURIComponent(id)}`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${this.agnesKey}` }, signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return { id, status: 'failed', progress: 0, url: null, error: 'This video is no longer available.' };
      if (!response.ok) return { id, status: 'running', progress: 0, url: null };
      return parseVideoJob(id, (await response.json()) as Record<string, unknown>);
    } catch {
      // A failed check is not a failed video; the app asks again.
      return { id, status: 'running', progress: 0, url: null };
    }
  }
}
