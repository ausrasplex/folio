import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // threads rather than the default forks: the PDF reader starts its own worker threads, and on Windows the forks pool's
  // message channel can close under them at teardown ("Channel closed"). Each file still runs in its own thread.
  test: { environment: 'node', include: ['src/**/*.test.ts'], pool: 'threads' },
  // src/lib/dc.js has JSX in a .js file (Next.js allows it), so parse source files as TSX
  esbuild: { include: /\.[jt]sx?$/, exclude: [], loader: 'tsx' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } }
});
