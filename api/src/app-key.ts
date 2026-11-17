import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Locks the REST API to known clients. A request passes with either:
 * - `X-API-Key: <key>` where the key is one of APP_API_KEYS (comma separated, so a key
 *   can be rotated by adding the new one before removing the old one), used by the app;
 * - `Authorization: Bearer <ADMIN_API_TOKEN>`, used by the admin panel, the cron job and the owner.
 * GET /health stays open for uptime checks. CORS preflights never reach this middleware.
 * With no APP_API_KEYS the API stays open in development and refuses requests in production.
 */
const OPEN_PATHS = new Set(['/health']);
const MIN_KEY_LENGTH = 32;

function matches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function appKeyMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method === 'OPTIONS' || OPEN_PATHS.has(request.path)) return next();

    const keys = (env.APP_API_KEYS ?? '').split(',').map((key) => key.trim()).filter((key) => key.length >= MIN_KEY_LENGTH);
    const adminToken = env.ADMIN_API_TOKEN ?? '';
    if (keys.length === 0) {
      if (env.NODE_ENV !== 'production') return next();
      response.status(503).json({ statusCode: 503, message: 'API access is not configured.' });
      return;
    }

    const suppliedKey = request.get('x-api-key') ?? '';
    const suppliedBearer = request.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const allowed = keys.some((key) => matches(suppliedKey, key))
      || (adminToken.length >= MIN_KEY_LENGTH && matches(suppliedBearer, adminToken));
    if (allowed) return next();
    response.status(401).json({ statusCode: 401, message: 'A valid API key is required.' });
  };
}
