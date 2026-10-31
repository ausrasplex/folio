// Background jobs while the server runs: automatic backups and sending alerts to connected services.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startJobs } = await import('./lib/server/jobs');
    if (!process.env.FOLIO_NO_JOBS) startJobs();
  }
}
