# The export worker. Build from the repository root:
#
#   docker build -t pentwin-worker .
#   docker run --rm -p 8787:8787 --memory=512m pentwin-worker
#
# Settings come from the environment (see .env.example and docs/environments.md).
# Nothing secret is baked into the image.

# --- Build: bundle the worker and everything it imports into one file ---
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so the install is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/billing/package.json packages/billing/
COPY packages/engine/package.json packages/engine/
COPY packages/extractor/package.json packages/extractor/
COPY packages/importers/package.json packages/importers/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json ./
COPY apps/worker apps/worker
COPY packages packages
RUN pnpm worker:build

# --- Run: Node and the one file, as an unprivileged user ---
FROM node:22-slim
ENV NODE_ENV=production \
    WORKER_PORT=8787 \
    EXPORT_STORAGE_DIR=/data/exports \
    PROFILE_STORAGE_DIR=/data/profiles \
    # Leaves room below a 512 MB limit for buffers outside the JavaScript heap.
    NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
# /data is where a persistent volume is mounted in production.
RUN mkdir -p /data/exports /data/profiles && chown -R node:node /data
COPY --from=build --chown=node:node /repo/dist/worker/main.cjs ./main.cjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.WORKER_PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "main.cjs"]
