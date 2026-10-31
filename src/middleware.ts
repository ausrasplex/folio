import { NextResponse, type NextRequest } from 'next/server';
import { PROXY_USER_HEADERS, fromTrustedProxy, frontDoor } from '@/lib/server/frontdoor';

// Runs before every page, route and file. Does nothing unless a front-door login is configured (see frontdoor.ts).
export const config = { runtime: 'nodejs', matcher: '/:path*' };

export async function middleware(req: NextRequest) {
  const door = await frontDoor(req.headers);
  if (!door.ok) return new NextResponse(door.why, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  // who-signed-in headers count only from our own proxies: from anyone else they are removed before Folio sees them
  if (PROXY_USER_HEADERS.some((n) => req.headers.has(n)) && !fromTrustedProxy(req.headers)) {
    const headers = new Headers(req.headers);
    for (const n of PROXY_USER_HEADERS) headers.delete(n);
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}
