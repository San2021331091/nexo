import type { NextFunction, Request, Response } from 'express';
import { appKeyMiddleware } from './app-key';

const APP_KEY = 'a'.repeat(40);
const ADMIN = 'b'.repeat(40);

function run(env: NodeJS.ProcessEnv, req: { method?: string; path?: string; headers?: Record<string, string> }) {
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const request = { method: req.method ?? 'GET', path: req.path ?? '/home', get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  const result: { status?: number; next: boolean } = { next: false };
  const response = { status(code: number) { result.status = code; return this; }, json() { return this; } } as unknown as Response;
  appKeyMiddleware(env)(request, response, (() => { result.next = true; }) as NextFunction);
  return result;
}

describe('appKeyMiddleware', () => {
  const env = { NODE_ENV: 'production', APP_API_KEYS: `${APP_KEY}, ${'c'.repeat(40)}`, ADMIN_API_TOKEN: ADMIN };

  it('accepts any configured app key', () => {
    expect(run(env, { headers: { 'X-API-Key': APP_KEY } }).next).toBe(true);
    expect(run(env, { headers: { 'X-API-Key': 'c'.repeat(40) } }).next).toBe(true);
  });
  it('accepts the admin bearer token', () => expect(run(env, { headers: { Authorization: `Bearer ${ADMIN}` } }).next).toBe(true));
  it('rejects missing or wrong keys', () => {
    expect(run(env, {}).status).toBe(401);
    expect(run(env, { headers: { 'X-API-Key': 'wrong' } }).status).toBe(401);
    expect(run(env, { headers: { Authorization: `Bearer ${APP_KEY}x` } }).status).toBe(401);
  });
  it('leaves health checks and CORS preflights open', () => {
    expect(run(env, { path: '/health' }).next).toBe(true);
    expect(run(env, { method: 'OPTIONS' }).next).toBe(true);
  });
  it('is open in development without keys and closed in production', () => {
    expect(run({ NODE_ENV: 'development' }, {}).next).toBe(true);
    expect(run({ NODE_ENV: 'production' }, {}).status).toBe(503);
  });
  it('ignores keys shorter than 32 characters', () => expect(run({ NODE_ENV: 'production', APP_API_KEYS: 'short' }, { headers: { 'X-API-Key': 'short' } }).status).toBe(503));
});
