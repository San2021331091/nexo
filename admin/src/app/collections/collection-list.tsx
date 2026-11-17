'use client';

import { FormEvent, useState } from 'react';

export type Entry = { id: string; title: string; slug: string; description: string; sort_order: number; is_featured: boolean; is_published: boolean; items: { content_type: string; content_id: string; position: number }[] };
type Option = { id: string; name: string };
type Sources = { channel: Option[]; movie: Option[]; series: Option[] };

const field = (label: string, name: string, value: string | number = '', required = false) => <label key={name} className="text-xs text-muted">{label}<input name={name} required={required} defaultValue={value} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white" /></label>;

export default function CollectionList({ collections, sources }: { collections: Entry[]; sources: Sources }) {
  const [items, setItems] = useState(collections);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [contentType, setContentType] = useState('channel');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const body = { title: String(form.get('title') ?? '').trim(), slug: String(form.get('slug') ?? '').trim(), description: String(form.get('description') ?? '').trim(), sortOrder: Number(form.get('sortOrder')) || 0, isFeatured: form.get('isFeatured') === 'on', isPublished: form.get('isPublished') === 'on' };
    try {
      const response = await fetch(id ? `/api/admin/collections/${encodeURIComponent(id)}` : '/api/admin/collections', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not save collection.');
      location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save collection.'); }
    finally { setBusy(false); }
  }

  async function remove(entry: Entry) {
    if (!window.confirm(`Delete collection “${entry.title}”?`)) return;
    try {
      const response = await fetch(`/api/admin/collections/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete collection.');
      setItems(items.filter(item => item.id !== entry.id));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete collection.'); }
  }

  async function addItem(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/admin/collections/${encodeURIComponent(id)}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: form.get('contentType'), contentId: form.get('contentId'), position: Number(form.get('position')) || 0 }) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not add item.');
      location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add item.'); }
    finally { setBusy(false); }
  }

  async function removeItem(id: string, type: string, contentId: string) {
    try {
      const response = await fetch(`/api/admin/collections/${encodeURIComponent(id)}/items/${encodeURIComponent(type)}/${encodeURIComponent(contentId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove item.');
      setItems(items.map(entry => entry.id === id ? { ...entry, items: entry.items.filter(item => !(item.content_type === type && item.content_id === contentId)) } : entry));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove item.'); }
  }

  const form = (entry?: Entry) => <form onSubmit={event => save(event, entry?.id)} className="grid gap-3 rounded-xl border border-white/8 bg-black/10 p-4 md:grid-cols-2">
    {field('Collection title', 'title', entry?.title ?? '', true)}{field('URL slug', 'slug', entry?.slug ?? '', true)}
    {field('Description', 'description', entry?.description ?? '')}{field('Sort order', 'sortOrder', entry?.sort_order ?? 0)}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFeatured" defaultChecked={entry?.is_featured ?? false} /> Feature on home</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublished" defaultChecked={entry?.is_published ?? false} /> Publish collection</label>
    <button disabled={busy} className="rounded-lg bg-gradient-to-r from-pink to-violet px-4 py-2 text-sm font-semibold md:col-span-2">{busy ? 'Saving…' : 'Save collection'}</button>
  </form>;

  const label = (type: string, id: string) => sources[type as keyof Sources]?.find(option => option.id === id)?.name ?? `${type}: ${id}`;

  return <section className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-panel">
    {error && <p role="alert" className="border-b border-white/10 px-5 py-3 text-sm text-amber-200">{error}</p>}
    <div className="flex items-center justify-between border-b border-white/10 p-4"><span className="text-xs text-muted">{items.length} COLLECTIONS</span><button onClick={() => setAdding(!adding)} className="rounded-lg border border-pink/50 px-3 py-2 text-xs text-pink">{adding ? 'Cancel' : 'Add collection +'}</button></div>
    {adding && form()}
    {items.map(entry => <article key={entry.id} className="border-b border-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{entry.title}</p><p className="mt-1 text-xs text-muted">/{entry.slug} · {entry.is_published ? 'Published' : 'Draft'} · {entry.is_featured ? 'Featured' : 'Not featured'}</p></div>
        <div className="flex gap-2"><button onClick={() => setSelected(selected === entry.id ? null : entry.id)} className="rounded-lg border border-pink/40 px-3 py-2 text-xs text-pink">{selected === entry.id ? 'Close items' : 'Manage items'}</button><button onClick={() => setEditing(editing === entry.id ? null : entry.id)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Edit</button><button onClick={() => remove(entry)} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-200">Delete</button></div>
      </div>
      {editing === entry.id && <div className="mt-4">{form(entry)}</div>}
      {selected === entry.id && <div className="mt-4 rounded-xl border border-white/8 bg-black/15 p-4">
        <h2 className="font-semibold">Collection items</h2>
        {entry.items.length === 0 ? <p className="mt-3 text-sm text-muted">No items yet.</p> : <ul className="my-3 space-y-2">{entry.items.map(item => <li key={`${item.content_type}-${item.content_id}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[.03] px-3 py-2 text-sm"><span>{label(item.content_type, item.content_id)} <span className="text-xs text-muted">· {item.content_type}</span></span><button onClick={() => removeItem(entry.id, item.content_type, item.content_id)} className="text-xs text-rose-200">Remove</button></li>)}</ul>}
        <form onSubmit={event => addItem(event, entry.id)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">Content type<select name="contentType" value={contentType} onChange={event => setContentType(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#17131e] px-3 py-2 text-sm"><option value="channel">Live channel</option><option value="movie">Movie</option><option value="series">Series</option></select></label>
          <label className="text-xs text-muted">Catalog item<select name="contentId" required className="mt-1 w-full rounded-lg border border-white/10 bg-[#17131e] px-3 py-2 text-sm">{sources[contentType as keyof Sources].map(option => <option key={`${contentType}-${option.id}`} value={option.id}>{option.name}</option>)}</select></label>
          {field('Order position', 'position', entry.items.length)}
          <button disabled={busy} className="self-end rounded-lg border border-pink/50 px-4 py-2 text-sm text-pink">Add item</button>
        </form>
      </div>}
    </article>)}
    {!items.length && !adding && <p className="p-8 text-sm text-muted">No collections yet. Add and publish an authorized curated rail.</p>}
  </section>;
}
