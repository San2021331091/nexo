import { NextRequest, NextResponse } from 'next/server';
import { apiBase } from '@/lib/api';

async function proxy(request: NextRequest, episodeId: string, method: 'PATCH' | 'DELETE') {
  const token = request.cookies.get('nexo_admin')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const response = await fetch(`${await apiBase()}/admin/episodes/${encodeURIComponent(episodeId)}`, { method, headers: { Authorization: `Bearer ${token}`, ...(method === 'PATCH' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'PATCH' ? { body: JSON.stringify(await request.json()) } : {}), cache: 'no-store' });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return NextResponse.json({ error: 'API unavailable' }, { status: 503 }); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; episodeId: string }> }) { const { episodeId } = await params; return proxy(request, episodeId, 'PATCH'); }
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; episodeId: string }> }) { const { episodeId } = await params; return proxy(request, episodeId, 'DELETE'); }
