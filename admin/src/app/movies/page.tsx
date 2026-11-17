import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import MovieList from './movie-list';
export default async function MoviesPage(){let response;try{response=await api('/admin/movies')}catch{redirect('/login')}if(response.status===401)redirect('/login');const result=await response.json().catch(()=>({data:[]}));return <main className="min-h-screen p-6 md:p-12"><Link href="/dashboard" className="text-sm text-pink">← Overview</Link><h1 className="mt-5 text-3xl font-semibold">Movies</h1><p className="mt-2 text-muted">Add authorized titles. Playback appears to viewers only after you publish the item.</p><MovieList movies={result.data??[]}/></main>}
