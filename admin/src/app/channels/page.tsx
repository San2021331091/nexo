import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import ChannelList from './channel-list';

export default async function ChannelsPage() {
  let response: Response;
  try {
    response = await api('/admin/channels');
  } catch {
    redirect('/login');
  }
  if (response.status === 401) redirect('/login');

  const payload = response.ok ? await response.json().catch(() => null) : null;
  const channels = Array.isArray(payload?.data) ? payload.data : [];
  const error = response.ok
    ? payload?.data
      ? ''
      : 'The channel API returned an unexpected response.'
    : `Could not load channels from the API (HTTP ${response.status}).`;

  return (
    <main className="min-h-screen p-6 md:p-12">
      <Link href="/dashboard" className="text-sm text-pink">Back to Overview</Link>
      <h1 className="mt-5 text-3xl font-semibold">Channels</h1>
      <p className="mt-2 text-muted">Loaded from the existing channeltb source.</p>
      <ChannelList channels={channels} initialError={error} />
    </main>
  );
}
