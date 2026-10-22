import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  poweredByHeader: false,
  // Docker builds use the standalone server; local `next start` keeps the default output.
  ...(process.env.NEXT_OUTPUT === 'standalone' && {
    output: 'standalone',
    outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  }),
  // Same-origin /api keeps the session cookie first-party (no tokens in the browser).
  rewrites: async () => [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }],
};

export default config;
