import { NextRequest } from 'next/server';
import { localBaseUrl } from '@nexo/api';

// /api/v1/* on this domain is the NestJS API (the public API the mobile app uses).
// Nest runs inside this function on a loopback port; requests are forwarded to it
// unchanged, so it applies its own CORS, validation, auth and headers.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length'];

async function forward(request: NextRequest): Promise<Response> {
  let base: string;
  try {
    base = await localBaseUrl();
  } catch (error) {
    console.error('NEXO API failed to start', error);
    return Response.json({ statusCode: 503, message: 'API unavailable' }, { status: 503 });
  }
  const url = new URL(request.url);
  const target = `${base.replace(/\/api\/v1$/, '')}${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });
  const responseHeaders = new Headers(upstream.headers);
  for (const name of [...HOP_BY_HOP, 'content-encoding']) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE, forward as OPTIONS, forward as HEAD };
