import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import SeriesList from './series-list';

export default async function SeriesPage() {
  let response: Response;
  try { response = await api('/admin/series'); }
  catch { redirect('/login'); }
  if (response.status === 401) redirect('/login');
  const result = await response.json().catch(() => ({ data: [] }));
  return <main className="min-h-screen p-6 md:p-12">
    <Link href="/dashboard" className="text-sm text-pink">← Overview</Link>
    <h1 className="mt-5 text-3xl font-semibold">Web series</h1>
    <p className="mt-2 text-muted">Manage authorized titles, seasons, episodes, and their playback references.</p>
    <SeriesList series={result.data ?? []} />
  </main>;
}
