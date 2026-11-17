'use client';
import { useState } from 'react';

type Channel = { id: string; name: string; category: string; description?: string | null; logoUrl?: string | null; playbackUrl: string | null; active?: boolean; supportsActive?: boolean; fbUrl?: string | null; twUrl?: string | null; youtubeUrl?: string | null; website?: string | null };

export default function ChannelList({ channels, initialError = '' }: { channels: Channel[]; initialError?: string }) {
  const [rows, setRows] = useState(channels);
  const [error, setError] = useState(initialError);
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle) || row.category.toLowerCase().includes(needle)) : rows;
  const playable = rows.filter((row) => row.playbackUrl).length;

  async function toggle(channel: Channel) {
    const next = channel.active === false;
    const response = await fetch(`/api/admin/channels/${encodeURIComponent(channel.id)}/active`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: next }) });
    if (!response.ok) { setError('Activation cannot be changed because the existing channeltb has no active/status column.'); return; }
    setRows((items) => items.map((item) => item.id === channel.id ? { ...item, active: next } : item));
  }
  async function remove(channel: Channel) {
    if (!window.confirm(`Delete ${channel.name} from channeltb? This action cannot be undone.`)) return;
    const response = await fetch(`/api/admin/channels/${encodeURIComponent(channel.id)}`, { method: 'DELETE' });
    if (!response.ok) { setError('Channel could not be deleted.'); return; }
    setRows((items) => items.filter((item) => item.id !== channel.id));
  }
  async function save(event: React.FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const keys = ['name', 'category', 'description', 'logoUrl', 'playbackUrl', 'fbUrl', 'twUrl', 'youtubeUrl', 'website'];
    const body = Object.fromEntries(keys.map((key) => [key, String(form.get(key) ?? '').trim()]));
    try {
      const response = await fetch(id ? `/api/admin/channels/${encodeURIComponent(id)}` : '/api/admin/channels', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not save channel.');
      location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save channel.'); } finally { setBusy(false); }
  }
  const input = (label: string, name: string, value = '', required = false) => <label key={name} className="text-xs text-muted">{label}<input required={required} name={name} defaultValue={value} placeholder={name.endsWith('Url') || name === 'website' ? 'https://…' : ''} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white" /></label>;
  const fields = (item?: Channel) => <>
    {input('Channel name', 'name', item?.name ?? '', true)}
    {input('Category', 'category', item?.category ?? '', true)}
    {input('Description', 'description', item?.description ?? '', true)}
    {input('Logo URL', 'logoUrl', item?.logoUrl ?? '', true)}
    {input('Playback URL (HTTPS stream or YouTube)', 'playbackUrl', item?.playbackUrl ?? '')}
    {input('Facebook URL', 'fbUrl', item?.fbUrl ?? '', true)}
    {input('Twitter / X URL', 'twUrl', item?.twUrl ?? '', true)}
    {input('YouTube URL', 'youtubeUrl', item?.youtubeUrl ?? '', true)}
    {input('Website URL', 'website', item?.website ?? '', true)}
    <button disabled={busy} className="self-end rounded-lg bg-gradient-to-r from-pink to-violet px-4 py-2 text-sm font-semibold">{busy ? 'Saving…' : 'Save channel'}</button>
  </>;

  return <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-panel">
    {error && <p role="alert" className="border-b border-white/10 px-5 py-3 text-sm text-amber-200">{error}</p>}
    <div className="flex items-center justify-between border-b border-white/8 p-4"><span className="text-xs text-muted">{rows.length} CHANNELS · {playable} WITH A SOURCE</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name or category" aria-label="Filter channels" className="mx-3 hidden min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white sm:block" /><button onClick={() => setCreate(!create)} className="rounded-lg border border-pink/50 px-3 py-2 text-xs text-pink">{create ? 'Cancel' : 'Add channel +'}</button></div>
    {create && <form onSubmit={(e) => save(e)} className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-2">{fields()}</form>}
    {visible.length ? visible.map((channel) => <div key={channel.id} className="border-b border-white/5 px-5 py-4">
      <div className="flex items-center justify-between gap-3"><div><p>{channel.name}</p><p className="mt-1 text-xs text-muted">{channel.category}</p></div><div className="flex items-center gap-2"><span className={`hidden rounded-full px-3 py-1 text-xs sm:inline ${channel.playbackUrl ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>{channel.playbackUrl ? 'Source configured' : 'Source unavailable'}</span><button onClick={() => setEditing(editing === channel.id ? null : channel.id)} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:border-pink">Edit</button>{channel.supportsActive ? <button onClick={() => toggle(channel)} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:border-pink">{channel.active === false ? 'Activate' : 'Deactivate'}</button> : <span className="hidden text-xs text-muted sm:inline">Always listed in current schema</span>}<button onClick={() => remove(channel)} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-200 hover:border-rose-300">Delete</button></div></div>
      {editing === channel.id && <form onSubmit={(e) => save(e, channel.id)} className="mt-4 grid gap-3 rounded-xl border border-white/8 bg-black/10 p-4 sm:grid-cols-2">{fields(channel)}</form>}
    </div>) : !create && <div className="p-8 text-sm text-muted">{rows.length ? 'No channels match this filter.' : 'No channel records are available.'}</div>}
  </div>;
}
