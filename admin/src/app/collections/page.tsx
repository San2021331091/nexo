import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import CollectionList, { type Entry } from './collection-list';

type Result<T> = { data: T };
type SourceItem = { id: string; name?: string; title?: string };

export default async function CollectionsPage() {
  let responses: Response[];
  try { responses = await Promise.all([api('/admin/collections'), api('/admin/channels'), api('/admin/movies'), api('/admin/series')]); }
  catch { redirect('/login'); }
  if (responses.some(response => response.status === 401)) redirect('/login');
  const [collections, channels, movies, series] = await Promise.all([
    responses[0].json().catch(() => ({ data: [] })) as Promise<Result<Entry[]>>,
    responses[1].json().catch(() => ({ data: [] })) as Promise<Result<SourceItem[]>>,
    responses[2].json().catch(() => ({ data: [] })) as Promise<Result<SourceItem[]>>,
    responses[3].json().catch(() => ({ data: [] })) as Promise<Result<SourceItem[]>>,
  ]);
  const options = (values: SourceItem[]) => values.map(value => ({ id: String(value.id), name: String(value.name ?? value.title ?? value.id) }));
  return <main className="min-h-screen p-6 md:p-12">
    <Link href="/dashboard" className="text-sm text-pink">← Overview</Link>
    <h1 className="mt-5 text-3xl font-semibold">Collections</h1>
    <p className="mt-2 text-muted">Curate published home page rails using existing channels and authorized catalog titles.</p>
    <CollectionList collections={collections.data ?? []} sources={{ channel: options(channels.data ?? []), movie: options(movies.data ?? []), series: options(series.data ?? []) }} />
  </main>;
}
