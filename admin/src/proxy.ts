import { NextRequest, NextResponse } from 'next/server';
export function proxy(request:NextRequest){const hasSession=Boolean(request.cookies.get('nexo_admin')?.value);if(!hasSession)return NextResponse.redirect(new URL('/login',request.url));return NextResponse.next();}
export const config={matcher:['/dashboard/:path*','/channels/:path*','/categories/:path*','/movies/:path*','/series/:path*','/collections/:path*','/settings/:path*']};
