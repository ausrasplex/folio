import { redirect } from 'next/navigation';
import { currentUser } from './auth';
import { db } from './db';

/** Pages need a signed-in person; a brand new server goes to first-run setup. */
export async function guard() {
  const u = await currentUser();
  if (!u) redirect((await db.user.count()) === 0 ? '/setup' : '/signin');
  return u;
}
