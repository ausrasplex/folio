import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // the Docker image (for Unraid) builds a standalone server; a plain `npm run build && npm start` does not need it
  output: process.env.FOLIO_STANDALONE ? 'standalone' : undefined,
  serverExternalPackages: ['pdfjs-dist', '@prisma/client', 'bcryptjs'],
  experimental: { serverActions: { bodySizeLimit: '30mb' } }
};

export default nextConfig;
