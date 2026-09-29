# syntax=docker/dockerfile:1
FROM node:24-slim AS builder
WORKDIR /app

# Enable pnpm via corepack or install pnpm
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

# Copy repo configuration and workspace package definitions
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY scripts/ scripts/

# Install dependencies and build the entire workspace
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    STANDALONE=true \
    HOST=0.0.0.0 \
    PORT=7860 \
    HOME=/home/trueforge \
    SQLITE_PATH=/tmp/trueforge/db.sqlite \
    CODE_MODE_SOCKET_PARENT=/tmp/trueforge/sockets \
    LOCAL_SANDBOX_ROOT_PARENT=/tmp/trueforge/sandboxes

RUN groupadd --gid 10001 trueforge \
  && useradd --uid 10001 --gid trueforge --create-home --shell /bin/bash trueforge \
  && mkdir -p /tmp/trueforge /home/trueforge \
  && chown -R trueforge:trueforge /tmp/trueforge /home/trueforge

# Copy built workspace and node_modules from builder
COPY --from=builder /app /app
RUN chown -R trueforge:trueforge /app

EXPOSE 7860

USER 10001:10001
CMD ["node", "packages/trueforge/dist/main.js"]
