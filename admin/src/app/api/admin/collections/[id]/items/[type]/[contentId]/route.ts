import { NextRequest, NextResponse } from 'next/server';
import { apiBase } from '@/lib/api';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; type: string; contentId: string }> }) {
  const { id, type, contentId } = await params;
  const token = request.cookies.get('nexo_admin')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const response = await fetch(`${await apiBase()}/admin/collections/${encodeURIComponent(id)}/items/${encodeURIComponent(type)}/${encodeURIComponent(contentId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return NextResponse.json({ error: 'API unavailable' }, { status: 503 }); }
}
