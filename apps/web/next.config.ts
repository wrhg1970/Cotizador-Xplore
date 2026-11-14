import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

// shortcut: 'unsafe-inline' scripts because Next inlines its bootstrap; move to nonces if XSS risk grows.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // Pixabay previews in the photo picker; everything else is served by us.
  "img-src 'self' data: blob: https://pixabay.com https://*.pixabay.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const config: NextConfig = {
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
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
