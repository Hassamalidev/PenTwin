import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// One .env for the whole repo, at its root. Values already in the environment win.
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const workerOrigin = new URL(process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8787').origin;
const analytics = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ? ' https://plausible.io' : '';

/**
 * What a page may load and where it may send data. Scripts and styles written into the
 * page are allowed ('unsafe-inline') because the framework and React rely on them and
 * the pages are built ahead of time, so they cannot carry a per-request nonce. The
 * tight parts are the ones that limit damage: data can only be sent to this site and the
 * export worker, nothing may be embedded or framed, and no plugin content runs.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${analytics}`,
  "style-src 'self' 'unsafe-inline'",
  // Previews are drawn from data and blob addresses made in the browser.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${workerOrigin}${analytics}`,
  // The PDF reader parses files in a background worker.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // Browsers ignore this over plain http, so it is harmless on localhost.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app asks for photos through the file picker, never through these.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  // The workspace packages are plain TypeScript source, compiled as part of the app.
  transpilePackages: [
    '@pentwin/engine',
    '@pentwin/extractor',
    '@pentwin/importers',
    '@pentwin/shared',
  ],
  // Type checking runs once for the whole repo (pnpm typecheck).
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  // The development server needs looser rules (it evaluates code to reload pages).
  headers: async () =>
    process.env.NODE_ENV === 'production' ? [{ source: '/:path*', headers: securityHeaders }] : [],
};

export default config;
