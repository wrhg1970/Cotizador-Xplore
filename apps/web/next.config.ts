import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  poweredByHeader: false,
  // Same-origin /api keeps the session cookie first-party (no tokens in the browser).
  rewrites: async () => [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }],
};

export default config;
