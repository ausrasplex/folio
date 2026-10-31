import { endSession } from '@/lib/server/auth';

export async function GET(req: Request) {
  await endSession();
  return Response.redirect(new URL('/signin', req.url), 303);
}
