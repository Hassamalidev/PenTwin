import type { NextConfig } from 'next';

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
};

export default config;
