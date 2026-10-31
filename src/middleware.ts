import { NextResponse, type NextRequest } from 'next/server';
import { frontDoor } from '@/lib/server/frontdoor';

// Runs before every page, route and file. Does nothing unless a front-door login is configured (see frontdoor.ts).
export const config = { runtime: 'nodejs', matcher: '/:path*' };

export async function middleware(req: NextRequest) {
  const door = await frontDoor(req.headers);
  if (!door.ok) return new NextResponse(door.why, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  return NextResponse.next();
}
