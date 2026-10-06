# syntax=docker/dockerfile:1.7

FROM golang:1.25-bookworm AS spynel-builder
WORKDIR /src/spynel
COPY services/spynel ./
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/spynel ./cmd/spynel \
  && mkdir -p /out/lib \
  && cp /go/pkg/mod/github.com/k2-fsa/sherpa-onnx-go-linux@v1.13.4/lib/x86_64-unknown-linux-gnu/*.so* /out/lib/

FROM node:24-bookworm-slim AS trueforge-builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json eslint.config.mjs .prettierrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    STANDALONE=true \
    HOST=0.0.0.0 \
    PORT=7860 \
    SQLITE_PATH=/data/trueforge/database/trueforge.sqlite \
    SPYNEL_WORKSPACE=/data/spynel/workspace \
    SPYNEL_SOCKET=/run/spynel/api.sock \
    LD_LIBRARY_PATH=/usr/local/bin/lib

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl dumb-init git procps wget \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 app \
  && useradd --uid 1000 --gid app --create-home --shell /bin/bash app \
  && mkdir -p /app /data/trueforge/database /data/trueforge/state /data/spynel/workspace /run/spynel \
  && chmod 0700 /run/spynel \
  && chown -R app:app /app /data /run/spynel

COPY --from=spynel-builder --chown=app:app /out/spynel /usr/local/bin/spynel
COPY --from=spynel-builder --chown=app:app /out/lib /usr/local/bin/lib
RUN LD_LIBRARY_PATH=/usr/local/bin/lib /usr/local/bin/spynel --version
COPY --from=trueforge-builder --chown=app:app /app /app

WORKDIR /app
USER 1000:1000
EXPOSE 7860
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/app/scripts/start-integrated.sh"]
