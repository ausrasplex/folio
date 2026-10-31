// At start-up: stamp each request with its real connection address (see socketip.ts), and run the background jobs
// while the server runs (automatic backups and sending alerts to connected services).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installSocketStamp } = await import('./lib/server/socketip');
    installSocketStamp();
    const { startJobs } = await import('./lib/server/jobs');
    if (!process.env.FOLIO_NO_JOBS) startJobs();
  }
}
