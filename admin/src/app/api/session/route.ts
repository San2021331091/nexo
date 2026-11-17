import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { apiBase } from '@/lib/api';

function matchesSecret(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Enter a username and password.' }, { status: 400 });
  }

  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'Enter a username and password.' }, { status: 400 });
  }

  const credentials = body as { username?: unknown; password?: unknown };
  if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string') {
    return NextResponse.json({ error: 'Enter a username and password.' }, { status: 400 });
  }

  const expectedUsername = process.env.ADMIN_LOGIN_USERNAME ?? '';
  const expectedPassword = process.env.ADMIN_LOGIN_PASSWORD ?? '';
  const apiToken = process.env.ADMIN_API_TOKEN ?? '';

  if (!expectedUsername || !expectedPassword || apiToken.length < 32) {
    return NextResponse.json({ error: 'Admin sign-in is not configured on the admin server.' }, { status: 503 });
  }

  if (!matchesSecret(credentials.username, expectedUsername) || !matchesSecret(credentials.password, expectedPassword)) {
    return NextResponse.json({ error: 'Incorrect operator username or password.' }, { status: 401 });
  }

  try {
    const verified = await fetch(`${await apiBase()}/admin/session`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: 'no-store',
    });

    if (verified.status === 401) {
      return NextResponse.json({ error: 'Admin API rejected its configured server credential.' }, { status: 503 });
    }
    if (!verified.ok) {
      return NextResponse.json({ error: 'Admin API is not ready. Check the backend and database connection.' }, { status: 503 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set('nexo_admin', apiToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Cannot connect to the admin API.' }, { status: 503 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('nexo_admin', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}
