'use client';

import { FormEvent, useEffect, useState } from 'react';

type Episode = { id: string; episode_number: number; title: string; synopsis: string; duration_minutes: number | null; playback_url: string | null; playback_kind: string };
type Season = { id: string; season_number: number; title: string; episodes: Episode[] };
type Series = { id: string; title: string; slug: string; synopsis: string; poster_url: string | null; backdrop_url: string | null; release_year: number | null; genres: string[]; language: string; is_published: boolean };

const field = (label: string, name: string, value: string | number = '', required = false) => (
  <label key={name} className="text-xs text-muted">{label}
    <input name={name} required={required} defaultValue={value} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white" />
  </label>
);

export default function SeriesList({ series }: { series: Series[] }) {
  const [items, setItems] = useState(series);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Series | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [editingSeason, setEditingSeason] = useState<string | null>(null);
  const [editingEpisode, setEditingEpisode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selected) { setSeasons([]); return; }
    let active = true;
    fetch(`/api/admin/series/${encodeURIComponent(selected.id)}/seasons`)
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.message ?? 'Could not load seasons.'); return result; })
      .then(result => { if (active) setSeasons(result.data ?? []); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load seasons.'); });
    return () => { active = false; };
  }, [selected]);

  async function save(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const body = {
      title: String(form.get('title') ?? '').trim(), slug: String(form.get('slug') ?? '').trim(),
      synopsis: String(form.get('synopsis') ?? '').trim(), posterUrl: String(form.get('posterUrl') ?? '').trim(),
      backdropUrl: String(form.get('backdropUrl') ?? '').trim(), releaseYear: Number(form.get('releaseYear')) || undefined,
      genres: String(form.get('genres') ?? '').split(',').map(value => value.trim()).filter(Boolean),
      language: String(form.get('language') ?? '').trim(), isPublished: form.get('isPublished') === 'on',
    };
    try {
      const response = await fetch(id ? `/api/admin/series/${encodeURIComponent(id)}` : '/api/admin/series', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not save series.');
      location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save series.'); }
    finally { setBusy(false); }
  }

  async function remove(item: Series) {
    if (!window.confirm(`Delete ${item.title} and its seasons and episodes? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/admin/series/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete series.');
      setItems(items.filter(value => value.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete series.'); }
  }

  async function createSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch(`/api/admin/series/${encodeURIComponent(selected.id)}/seasons`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonNumber: Number(form.get('seasonNumber')), title: String(form.get('title') ?? '') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not add season.');
      const updatedSeasons = await fetch(`/api/admin/series/${encodeURIComponent(selected.id)}/seasons`);
      setSeasons((await updatedSeasons.json()).data ?? []);
      formElement.reset();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add season.'); }
    finally { setBusy(false); }
  }

  async function createEpisode(event: FormEvent<HTMLFormElement>, seasonId: string) {
    event.preventDefault(); setBusy(true); setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const playbackUrl = String(form.get('playbackUrl') ?? '').trim();
    try {
      const response = await fetch(`/api/admin/seasons/${encodeURIComponent(seasonId)}/episodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber: Number(form.get('episodeNumber')), title: String(form.get('title') ?? '').trim(), synopsis: String(form.get('synopsis') ?? '').trim(), durationMinutes: Number(form.get('durationMinutes')) || undefined, playbackUrl, playbackKind: String(form.get('playbackKind') ?? 'hls') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not add episode.');
      const updated = await fetch(`/api/admin/series/${encodeURIComponent(selected!.id)}/seasons`);
      setSeasons((await updated.json()).data ?? []);
      formElement.reset();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add episode.'); }
    finally { setBusy(false); }
  }

  async function refreshSeasons() {
    if (!selected) return;
    const response = await fetch(`/api/admin/series/${encodeURIComponent(selected.id)}/seasons`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Could not refresh seasons.');
    setSeasons(result.data ?? []);
  }

  async function updateSeason(event: FormEvent<HTMLFormElement>, season: Season) {
    event.preventDefault(); setBusy(true); setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch(`/api/admin/seasons/${encodeURIComponent(season.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seasonNumber: Number(form.get('seasonNumber')), title: String(form.get('title') ?? '').trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not update season.');
      setEditingSeason(null); await refreshSeasons();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update season.'); }
    finally { setBusy(false); }
  }

  async function updateEpisode(event: FormEvent<HTMLFormElement>, seasonId: string, episode: Episode) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/admin/seasons/${encodeURIComponent(seasonId)}/episodes/${encodeURIComponent(episode.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeNumber: Number(form.get('episodeNumber')), title: String(form.get('title') ?? '').trim(), synopsis: String(form.get('synopsis') ?? '').trim(), durationMinutes: Number(form.get('durationMinutes')) || undefined, playbackUrl: String(form.get('playbackUrl') ?? '').trim(), playbackKind: String(form.get('playbackKind') ?? 'hls') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not update episode.');
      setEditingEpisode(null); await refreshSeasons();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update episode.'); }
    finally { setBusy(false); }
  }

  async function removeSeason(season: Season) {
    if (!window.confirm(`Delete season ${season.season_number} and its episodes?`)) return;
    try {
      const response = await fetch(`/api/admin/seasons/${encodeURIComponent(season.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete season.');
      await refreshSeasons();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete season.'); }
  }

  async function removeEpisode(seasonId: string, episode: Episode) {
    if (!window.confirm(`Delete episode “${episode.title}”?`)) return;
    try {
      const response = await fetch(`/api/admin/seasons/${encodeURIComponent(seasonId)}/episodes/${encodeURIComponent(episode.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete episode.');
      await refreshSeasons();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete episode.'); }
  }

  const form = (item?: Series) => <form onSubmit={event => save(event, item?.id)} className="grid gap-3 rounded-xl border border-white/8 bg-black/10 p-4 md:grid-cols-2">
    {field('Series title', 'title', item?.title ?? '', true)}{field('URL slug', 'slug', item?.slug ?? '', true)}
    {field('Synopsis', 'synopsis', item?.synopsis ?? '')}{field('Poster URL (HTTPS)', 'posterUrl', item?.poster_url ?? '')}
    {field('Backdrop URL (HTTPS)', 'backdropUrl', item?.backdrop_url ?? '')}{field('Year', 'releaseYear', item?.release_year?.toString() ?? '')}
    {field('Genres (comma separated)', 'genres', item?.genres?.join(', ') ?? '')}{field('Language', 'language', item?.language ?? '')}
    <label className="flex items-center gap-2 text-sm text-white md:col-span-2"><input type="checkbox" name="isPublished" defaultChecked={item?.is_published ?? false} /> Publish in the viewer catalog</label>
    <button disabled={busy} className="rounded-lg bg-gradient-to-r from-pink to-violet px-4 py-2 text-sm font-semibold md:col-span-2">{busy ? 'Saving…' : 'Save series'}</button>
  </form>;

  return <section className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-panel">
    {error && <p role="alert" className="border-b border-white/10 px-5 py-3 text-sm text-amber-200">{error}</p>}
    <div className="flex items-center justify-between border-b border-white/10 p-4"><span className="text-xs text-muted">{items.length} SERIES</span><button onClick={() => setAdding(!adding)} className="rounded-lg border border-pink/50 px-3 py-2 text-xs text-pink">{adding ? 'Cancel' : 'Add series +'}</button></div>
    {adding && form()}
    {items.map(item => <article key={item.id} className="border-b border-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted">/{item.slug} · {item.is_published ? 'Published' : 'Draft'}</p></div>
        <div className="flex gap-2"><button onClick={() => setSelected(selected?.id === item.id ? null : item)} className="rounded-lg border border-pink/40 px-3 py-2 text-xs text-pink">{selected?.id === item.id ? 'Close seasons' : 'Manage seasons'}</button><button onClick={() => setEditing(editing === item.id ? null : item.id)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Edit</button><button onClick={() => remove(item)} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-200">Delete</button></div>
      </div>
      {editing === item.id && <div className="mt-4">{form(item)}</div>}
      {selected?.id === item.id && <div className="mt-5 space-y-4 rounded-xl border border-white/8 bg-black/15 p-4">
        <h2 className="font-semibold">Seasons and episodes</h2>
        <form onSubmit={createSeason} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          {field('Season number', 'seasonNumber', '', true)}{field('Season title', 'title')}
          <button disabled={busy} className="self-end rounded-lg border border-pink/50 px-4 py-2 text-sm text-pink">Add season</button>
        </form>
        {seasons.length === 0 && <p className="text-sm text-muted">No seasons yet.</p>}
        {seasons.map(season => <div key={season.id} className="rounded-lg border border-white/8 p-3">
          <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Season {season.season_number}{season.title ? ` · ${season.title}` : ''}</h3><div className="flex gap-2"><button type="button" onClick={() => setEditingSeason(editingSeason === season.id ? null : season.id)} className="text-xs text-pink">Edit season</button><button type="button" onClick={() => removeSeason(season)} className="text-xs text-rose-200">Delete season</button></div></div>
          {editingSeason === season.id && <form onSubmit={event => updateSeason(event, season)} className="my-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]">{field('Season number', 'seasonNumber', season.season_number, true)}{field('Season title', 'title', season.title)}<button disabled={busy} className="self-end rounded-lg border border-pink/50 px-4 py-2 text-sm text-pink">Save season</button></form>}
          <ul className="my-3 space-y-2 text-xs text-muted">{season.episodes?.map(episode => <li key={episode.id} className="rounded-md bg-white/[.03] p-3"><div className="flex items-center justify-between gap-2"><span>Episode {episode.episode_number}: {episode.title} · {episode.playback_url ? 'Source set' : 'Unavailable'}</span><div className="flex gap-2"><button type="button" onClick={() => setEditingEpisode(editingEpisode === episode.id ? null : episode.id)} className="text-pink">Edit</button><button type="button" onClick={() => removeEpisode(season.id, episode)} className="text-rose-200">Delete</button></div></div>
            {editingEpisode === episode.id && <form onSubmit={event => updateEpisode(event, season.id, episode)} className="mt-3 grid gap-3 md:grid-cols-2">
              {field('Episode number', 'episodeNumber', episode.episode_number, true)}{field('Episode title', 'title', episode.title, true)}
              {field('Synopsis', 'synopsis', episode.synopsis)}{field('Duration in minutes', 'durationMinutes', episode.duration_minutes ?? '')}
              {field('Authorized playback URL', 'playbackUrl', episode.playback_url ?? '')}
              <label className="text-xs text-muted">Playback type<select name="playbackKind" defaultValue={episode.playback_kind} className="mt-1 w-full rounded-lg border border-white/10 bg-[#17131e] px-3 py-2 text-sm"><option value="hls">Authorized HLS</option><option value="dash">Authorized DASH</option><option value="youtube">Official YouTube</option><option value="iframe">Allowlisted embed</option><option value="unavailable">Unavailable</option></select></label>
              <button disabled={busy} className="rounded-lg border border-pink/50 px-4 py-2 text-sm text-pink md:col-span-2">Save episode</button>
            </form>}
          </li>)}</ul>
          <form onSubmit={event => createEpisode(event, season.id)} className="grid gap-3 md:grid-cols-2">
            {field('Episode number', 'episodeNumber', '', true)}{field('Episode title', 'title', '', true)}
            {field('Synopsis', 'synopsis')}{field('Duration in minutes', 'durationMinutes')}
            {field('Authorized playback URL', 'playbackUrl')}
            <label className="text-xs text-muted">Playback type<select name="playbackKind" className="mt-1 w-full rounded-lg border border-white/10 bg-[#17131e] px-3 py-2 text-sm"><option value="hls">Authorized HLS</option><option value="dash">Authorized DASH</option><option value="youtube">Official YouTube</option><option value="iframe">Allowlisted embed</option></select></label>
            <button disabled={busy} className="rounded-lg border border-pink/50 px-4 py-2 text-sm text-pink md:col-span-2">Add episode</button>
          </form>
        </div>)}
      </div>}
    </article>)}
    {!items.length && !adding && <p className="p-8 text-sm text-muted">No series yet. Add an authorized title and metadata to start building the catalog.</p>}
  </section>;
}
