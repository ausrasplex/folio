import type { NextConfig } from 'next';

// Security headers on every page and file. The development server also needs eval (hot reload) and a WebSocket.
const dev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'", // the screens use inline styles
  "script-src 'self' 'unsafe-inline'" + (dev ? " 'unsafe-eval'" : ''),
  "worker-src 'self' blob:", // the pdf.js worker
  "connect-src 'self'" + (dev ? ' ws: wss:' : ''),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // only when Folio is reached over HTTPS: browsers then refuse plain HTTP to it for a year
  ...(/^https:\/\//i.test(process.env.FOLIO_URL || '') ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : [])
];

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // the Docker image (for Unraid) builds a standalone server; a plain `npm run build && npm start` does not need it
  output: process.env.FOLIO_STANDALONE ? 'standalone' : undefined,
  serverExternalPackages: ['pdfjs-dist', '@prisma/client', 'bcryptjs'],
  experimental: { serverActions: { bodySizeLimit: '30mb' } },
  async headers() { return [{ source: '/:path*', headers: securityHeaders }]; }
};

export default nextConfig;
