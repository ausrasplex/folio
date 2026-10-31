import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  // src/lib/dc.js has JSX in a .js file (Next.js allows it), so parse source files as TSX
  esbuild: { include: /\.[jt]sx?$/, exclude: [], loader: 'tsx' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } }
});
