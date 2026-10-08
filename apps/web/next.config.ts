import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// One .env for the whole repo, at its root. Values already in the environment win.
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

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
