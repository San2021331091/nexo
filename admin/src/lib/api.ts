import { cookies } from 'next/headers';

// Set API_BASE_URL only to use a separately hosted API (for example the
// Nest dev server on :4000). Leave it unset on Vercel: the API then runs inside this
// app and server code reaches it in-process.
const configuredBase = process.env.API_BASE_URL?.trim().replace(/\/$/, '') || '';
const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
if (configuredBase && process.env.NODE_ENV === 'production' && !isBuild && new URL(configuredBase).protocol !== 'https:') {
  throw new Error('API_BASE_URL must use HTTPS in production.');
}

export async function apiBase(): Promise<string> {
  if (configuredBase) return configuredBase;
  const { localBaseUrl } = await import('@nexo/api');
  return localBaseUrl();
}

export async function api(path: string, init: RequestInit = {}) {
  const token = (await cookies()).get('nexo_admin')?.value;
  return fetch(`${await apiBase()}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
}
