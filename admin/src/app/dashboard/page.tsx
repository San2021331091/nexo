import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import Dashboard from './view';

const emptyStats = {
  channels: 0,
  movies: 0,
  series: 0,
  providerStatus: 'Unavailable',
  apiAvailable: false,
};

export default async function DashboardPage() {
  let response: Response;
  try {
    response = await api('/admin/overview');
  } catch {
    redirect('/login');
  }

  if (response.status === 401) redirect('/login');

  const result = response.ok
    ? await response.json().catch(() => null)
    : null;
  const data = result?.data;
  const stats = data
    ? {
        channels: Number(data.channels) || 0,
        movies: Number(data.movies) || 0,
        series: Number(data.series) || 0,
        providerStatus: String(data.providerStatus || 'Unavailable'),
        apiAvailable: true,
      }
    : emptyStats;

  return <Dashboard stats={stats} />;
}
