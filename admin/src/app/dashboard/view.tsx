'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const nav = [
  ['Overview', '/dashboard', '◈'], ['Channels', '/channels', '◉'],
  ['Categories', '/categories', '○'], ['Movies', '/movies', '▣'],
  ['Web series', '/series', '▤'], ['Collections', '/collections', '◇'],
  ['Settings', '/settings', '⚙'],
];

type Stats = { channels: number; movies: number; series: number; providerStatus: string; apiAvailable: boolean };

export default function Dashboard({ stats }: { stats: Stats }) {
  const path = usePathname();
  const router = useRouter();
  const reportEmail = process.env.NEXT_PUBLIC_CONTENT_REPORT_EMAIL;
  const navigation = (compact = false) => <nav className={compact ? 'flex gap-2 overflow-x-auto px-4 py-3 md:hidden' : 'space-y-2'}>
    {nav.map(([label, href, icon]) => <Link key={href} href={href} className={`${compact ? 'shrink-0' : 'flex'} items-center gap-3 rounded-xl px-4 py-3 text-sm ${path === href ? 'bg-pink/15 text-pink' : 'text-muted hover:bg-white/5 hover:text-white'}`}>
      <span aria-hidden="true">{icon}</span>{label}
    </Link>)}
  </nav>;

  return <div className="min-h-screen md:flex">
    <aside className="hidden w-64 shrink-0 border-r border-white/8 bg-[#100d15] p-6 md:flex md:flex-col">
      <div className="mb-12 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-pink to-violet font-black">N</div><div className="font-bold tracking-widest">NEXO <span className="block text-[10px] font-normal tracking-[.2em] text-muted">CONTROL ROOM</span></div></div>
      {navigation()}
      <div className="mt-auto rounded-2xl border border-white/8 bg-white/[.03] p-4"><span className="text-xs text-muted">OPERATIONS</span><p className="mt-2 text-sm">Guest access enabled</p><p className="mt-1 text-xs text-emerald-300">● API connected</p></div>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="flex items-center justify-between border-b border-white/8 px-5 py-5 md:px-10"><div><p className="text-xs uppercase tracking-[.24em] text-pink">NEXO / OPERATIONS</p><h1 className="mt-1 text-xl font-semibold">Overview</h1></div><button onClick={async () => { await fetch('/api/session', { method: 'DELETE' }); router.replace('/login'); }} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-muted hover:text-white">Sign out</button></header>
      {navigation(true)}
      <div className="mx-auto max-w-6xl p-5 md:p-10">
        <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#321b35] via-[#201525] to-panel p-7 md:p-10"><div className="absolute -right-10 -top-20 h-64 w-64 rounded-full bg-pink/10 blur-3xl"/><p className="relative text-sm text-pink" suppressHydrationWarning>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase().replace(', ', ' · ')}</p><h2 className="relative mt-3 max-w-xl text-3xl font-semibold md:text-4xl">Your catalog, <span className="text-pink">in focus.</span></h2><p className="relative mt-3 max-w-lg text-sm leading-relaxed text-white/65">A clear view of your live catalog and source readiness. Viewer browsing stays open without an account.</p></section>
        {!stats.apiAvailable && <div role="alert" className="mt-7 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100"><p className="font-semibold">The catalog API is not answering correctly.</p><p className="mt-1 text-amber-100/80">Counts below are unavailable, not zero. Restart the API (npm run api:dev) and reload this page.</p></div>}
        <div className="mt-7 grid gap-4 sm:grid-cols-3">{[['Live channels', stats.channels, 'From the existing Neon tables'], ['Movies', stats.movies, 'Catalog titles, including drafts'], ['Web series', stats.series, 'Catalog titles, including drafts']].map(([label, value, caption]) => <article key={String(label)} className="rounded-2xl border border-white/8 bg-panel p-5"><p className="text-sm text-muted">{label}</p><p className="mt-4 text-3xl font-semibold">{stats.apiAvailable ? value : '—'}</p><p className="mt-2 text-xs text-muted">{caption}</p></article>)}</div>
        <div className="mt-7 grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
          <section className="rounded-2xl border border-white/8 bg-panel p-6"><div className="flex items-center justify-between"><h3 className="font-semibold">Catalog health</h3><span className={`rounded-full px-3 py-1 text-xs ${stats.apiAvailable ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>{stats.apiAvailable ? 'API reachable' : 'API unavailable'}</span></div><div className="mt-5 space-y-4 text-sm"><div className="flex justify-between border-b border-white/5 pb-4"><span className="text-muted">Channel/category source</span><span>Existing Neon tables</span></div><div className="flex justify-between border-b border-white/5 pb-4"><span className="text-muted">Movies and series</span><span>Separate catalog tables</span></div><div className="flex justify-between"><span className="text-muted">Playback providers</span><span className="text-muted">Manual authorized URLs</span></div></div></section>
          <section className="rounded-2xl border border-white/8 bg-panel p-6"><h3 className="font-semibold">Availability</h3><p className="mt-3 text-sm leading-relaxed text-muted">{stats.providerStatus}. Content availability depends on rights and the source provider.</p>{reportEmail ? <a className="mt-5 inline-block text-sm text-pink underline decoration-pink/40 underline-offset-4" href={`mailto:${reportEmail}?subject=Content%20availability%20report`}>Report a content issue →</a> : <p className="mt-5 text-xs text-muted">Configure NEXT_PUBLIC_CONTENT_REPORT_EMAIL to enable content reports.</p>}</section>
        </div>
      </div>
    </main>
  </div>;
}
