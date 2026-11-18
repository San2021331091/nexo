import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { apiBase } from '@/lib/api';

// Vercel Cron calls this once a day (see vercel.json) with "Authorization: Bearer
// $CRON_SECRET". It adds the day's full episodes and movies from the official
// YouTube channels to the library and waits until they are stored.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(header: string | null, secret: string): boolean {
  const supplied = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const token = process.env.ADMIN_API_TOKEN ?? '';
  if (secret.length < 16 || token.length < 32) return NextResponse.json({ error: 'Cron is not configured.' }, { status: 503 });
  if (!authorized(request.headers.get('authorization'), secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const response = await fetch(`${await apiBase()}/admin/youtube-library/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: 'API unavailable' }, { status: 503 });
  }
}
