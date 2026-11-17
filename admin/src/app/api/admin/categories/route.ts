import { NextRequest, NextResponse } from 'next/server';
import { apiBase } from '@/lib/api';
async function proxy(request:NextRequest,method:'GET'|'POST'){const token=request.cookies.get('nexo_admin')?.value;if(!token)return NextResponse.json({error:'Unauthorized'},{status:401});try{const response=await fetch(`${await apiBase()}/admin/categories`,{method,headers:{Authorization:`Bearer ${token}`,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(await request.json())}:{}),cache:'no-store'});return NextResponse.json(await response.json(),{status:response.status});}catch{return NextResponse.json({error:'API unavailable'},{status:503});}}
export async function GET(request:NextRequest){return proxy(request,'GET');}
export async function POST(request:NextRequest){return proxy(request,'POST');}
