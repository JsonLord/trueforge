# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && pnpm config set store-dir /pnpm/store
WORKDIR /app

FROM base AS store
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM store AS workspace
COPY package.json .npmrc tsconfig.base.json ./
COPY scripts scripts
COPY packages/trueforge-core/package.json packages/trueforge-core/package.json
COPY packages/trueforge/package.json packages/trueforge/package.json
COPY packages/trueforge-sdk/package.json packages/trueforge-sdk/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/trueforge-ui/package.json packages/trueforge-ui/package.json
COPY packages/trueforge-core/scripts packages/trueforge-core/scripts
COPY packages/trueforge-core/src/core/sandbox/scripts packages/trueforge-core/src/core/sandbox/scripts

FROM workspace AS builder
RUN pnpm install --frozen-lockfile --offline --filter @truefoundry/trueforge...
COPY packages/trueforge-core packages/trueforge-core
COPY packages/trueforge-sdk packages/trueforge-sdk
RUN pnpm --filter @truefoundry/trueforge-sdk build
COPY packages/trueforge packages/trueforge
RUN pnpm --filter @truefoundry/trueforge-core build && pnpm --filter @truefoundry/trueforge build

FROM workspace AS frontend-builder
RUN pnpm install --frozen-lockfile --offline --filter frontend...
COPY packages/trueforge-sdk packages/trueforge-sdk
COPY packages/trueforge-ui packages/trueforge-ui
RUN pnpm --filter @truefoundry/trueforge-ui build
COPY packages/frontend packages/frontend
RUN pnpm --filter frontend build

FROM workspace AS prod-deps
RUN pnpm install --frozen-lockfile --offline --prod --filter @truefoundry/trueforge...

FROM base AS runner

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    STANDALONE=true \
    HOME=/home/trueforge \
    SQLITE_PATH=/home/trueforge/db.sqlite

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/trueforge-core/node_modules ./packages/trueforge-core/node_modules
COPY --from=prod-deps /app/packages/trueforge/node_modules ./packages/trueforge/node_modules

COPY --from=builder /app/packages/trueforge-core/package.json ./packages/trueforge-core/package.json
COPY --from=builder /app/packages/trueforge-core/dist ./packages/trueforge-core/dist
COPY --from=builder /app/packages/trueforge-sdk/package.json ./packages/trueforge-sdk/package.json
COPY --from=builder /app/packages/trueforge-sdk/dist ./packages/trueforge-sdk/dist

COPY --from=builder /app/packages/trueforge/package.json ./packages/trueforge/package.json
COPY --from=builder /app/packages/trueforge/dist ./packages/trueforge/dist
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/trueforge/dist/_frontend

WORKDIR /app/packages/trueforge

RUN groupadd --gid 10001 trueforge \
  && useradd --uid 10001 --gid trueforge -m trueforge \
  && mkdir -p /home/trueforge \
  && chown -R 10001:10001 /home/trueforge /app

EXPOSE 7860

USER 10001:10001
CMD ["node", "dist/main.js"]
