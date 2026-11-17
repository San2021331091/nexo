import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';

type Settings = { database?: boolean; tmdb?: boolean; superembed?: boolean; superembedHost?: string | null; sportsYouTubeChannels?: number; playbackAllowlist?: number };

function Row({ label, detail, ok, value }: { label: string; detail: string; ok: boolean; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-t border-white/10 py-4 text-sm">
    <div><p>{label}</p><p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p></div>
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs ${ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>{value}</span>
  </div>;
}

export default async function SettingsPage() {
  let response;
  try { response = await api('/admin/settings'); } catch { redirect('/login'); }
  if (response.status === 401) redirect('/login');
  const settings: Settings = (await response.json().catch(() => ({ data: {} }))).data ?? {};
  const allowlist = settings.playbackAllowlist ?? 0;
  return <main className="p-8 md:p-12">
    <Link href="/dashboard" className="text-sm text-pink">← Overview</Link>
    <h1 className="mt-5 text-3xl font-semibold">Settings</h1>
    <section className="mt-8 max-w-2xl rounded-2xl border border-white/10 bg-panel p-6">
      <h2 className="font-semibold">Provider readiness</h2>
      <p className="mt-3 pb-4 text-sm leading-relaxed text-muted">Providers are configured in the API environment file. Secret values are never shown here.</p>
      <Row label="Catalog database" detail="Channels and categories are read from channeltb and categorydb." ok={Boolean(settings.database)} value={settings.database ? 'Connected' : 'Not configured'} />
      <Row label="TMDB metadata" detail="Movie, series and drama listings, artwork and episode guides. Set TMDB_API_KEY." ok={Boolean(settings.tmdb)} value={settings.tmdb ? 'Enabled' : 'Missing key'} />
      <Row label="Superembed (movies, series and dramas)" detail="Playback by TMDB id. Titles are listed only after Superembed confirms it has them. Override with SUPEREMBED_BASE_URL, or set it to off." ok={Boolean(settings.superembed)} value={settings.superembed ? settings.superembedHost ?? 'Enabled' : 'Disabled'} />
      <Row label="YouTube sports feeds" detail="Sports rails use official YouTube embeds from the channels in SPORTS_YOUTUBE_CHANNELS." ok={(settings.sportsYouTubeChannels ?? 0) > 0} value={`${settings.sportsYouTubeChannels ?? 0} channels`} />
      <Row label="Playback host allowlist" detail="Optional. When PLAYBACK_ALLOWED_HOSTS is empty, any HTTPS stream URL stored in the catalog is playable." ok value={allowlist ? `${allowlist} hosts` : 'Any HTTPS host'} />
      <Row label="Public viewer access" detail="Viewers browse and watch without an account." ok value="Guest enabled" />
    </section>
  </main>;
}
