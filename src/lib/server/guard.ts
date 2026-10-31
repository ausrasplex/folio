import { redirect } from 'next/navigation';
import { currentUser, needsTwoStep, TWO_STEP_PAGE } from './auth';
import { db } from './db';

/** Pages need a signed-in person; a brand new server goes to first-run setup. When the server requires two-step
 *  verification and the person has not turned it on, every page but Profile (twoStepSetup) sends them there. */
export async function guard(opts: { twoStepSetup?: boolean } = {}) {
  const u = await currentUser();
  if (!u) redirect((await db.user.count()) === 0 ? '/setup' : '/signin');
  if (!opts.twoStepSetup && (await needsTwoStep(u))) redirect(TWO_STEP_PAGE);
  return u;
}
