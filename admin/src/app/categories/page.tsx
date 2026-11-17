import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import CategoryList from './category-list';
export default async function CategoriesPage(){let response;try{response=await api('/admin/categories')}catch{redirect('/login')}if(response.status===401)redirect('/login');const result=await response.json().catch(()=>({data:[]}));return <main className="min-h-screen p-6 md:p-12"><Link href="/dashboard" className="text-sm text-pink">← Overview</Link><h1 className="mt-5 text-3xl font-semibold">Categories</h1><p className="mt-2 text-muted">Uses the existing categorydb records. Category names stay fixed while channels refer to them by text.</p><CategoryList categories={result.data??[]}/></main>}
