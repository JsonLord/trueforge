# Deployment-owned Needle service

This directory owns the optional loopback transport for Needle. `trueforge-core` remains provider-neutral and retains
all authorization, approval, validation, session, and execution authority. This service can only return classifications,
embedding vectors, and argument proposals. It has no general execution endpoint and never calls `Needle.run()`.

## Status

### Implemented

- Loopback HTTP contracts: `GET /health`, `POST /v1/classify`, `POST /v1/embed`, and `POST /v1/extract`.
- A serialized backend gateway, strict response validation, safe errors, and degraded runtime-unavailable behavior.
- A deployment ESM client shared by classification, embeddings, extraction, and the existing live evaluator.
- Pinned acquisition, API introspection, runtime smoke, and retrieval benchmark scripts.

### Mock verified

Unit tests exercise contract validation, deterministic backend behavior, serialization, late timeout isolation, HTTP
status handling, ESM response validation, aborts, and deterministic retrieval metrics. The fake backend exists only in
tests; production never falls back to it.

### Runtime verified

Verified on September 25, 2026 with Python 3.13.13. Direct access to PyPI, Hugging Face, and GitHub succeeded. The
hash-verified `cactus-needle==3.0.5` API package loaded the official generation-3 Linux engine and the pinned model.
Construction, structured completion without execution, reset, 3,072-dimensional embeddings, extraction, repeated
inference, loopback HTTP service, and retrieval were exercised against the native runtime.

The earlier Codex sandbox HTTPS proxy blocker is historical. The upstream 3.0.5 fetch helper maps generation 3 to native
version 3.0.2, but that platform wheel is not published. The reproducible bootstrap instead extracts `libneedle3.so`
from the official 3.0.1 `manylinux2014_x86_64` wheel at pinned repository revision
`b274efcb211a9eef48c9a88da4b43bd569696a39`. This library exports the ABI used by 3.0.5 and successfully loads the
pinned archive. It does not replace the installed Python package.

## Pins and storage

- Package: `cactus-needle==3.0.5`
- Wheel: `cactus_needle-3.0.5-py3-none-any.whl`
- Wheel SHA-256: `3987dd18f7fdd4954b92e75e8be08c37ccd0b1f898ed19a1267770cf1be20816`
- Publishing source: `42bf1f2d0a7784b0d4d1ec94bb5ade425cf9a67c`
- Model: `Cactus-Compute/needle3@3e8e2a66057a29694052d915128b91b53e7e5ead`
- Model file: `needle3.cact`, 35,335,380 bytes
- Model SHA-256: `c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38`
- Engine platform: `manylinux2014_x86_64`, acquired from the official repository wheel
- Engine artifact: `cactus_needle-3.0.1-py3-none-manylinux2014_x86_64.whl`
- Engine repository revision: `b274efcb211a9eef48c9a88da4b43bd569696a39`
- Engine artifact SHA-256: `05770ef9a85686583968ea15f62f9ad44217e078efdaa99559d3208bb8a369b0`
- Native library: `libneedle3.so`, extracted as `engine/libneedle.so`, 1,294,696 bytes
- Native library SHA-256: `978fce130aac08af506b5fe8bb2950da58e9479d0de69d972d9bd69db953568d`

`NEEDLE_HOME` defaults to `~/.local/share/trueforge/needle`. It contains the dedicated Python 3.13 environment,
downloads, engine, model, dependency freeze, and engine identity reports. Set `NEEDLE3_LIB_PATH` to the verified engine.
Set `NEEDLE_MODEL_PATH` to the verified `needle3.cact` file.

## Configuration

Copy `.env.example` into deployment-owned configuration. The server defaults to `127.0.0.1:8792`; do not publish this
port. `NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1` disable telemetry. After acquisition, use `HF_HUB_OFFLINE=1` to enforce
steady-state offline behavior. Health reports `degraded` and operations return `runtime_unavailable` until the production
backend has actually initialized; it never falsely reports ready.

Timeouts stop waiting for a caller response but do not claim to cancel native inference. The single-worker gateway keeps
late work serialized, so the stateful backend is not concurrently reused. Requests, schemas, arguments, vectors, paths,
environment values, and credentials are not logged.

## Operator verification sequence

Run these repository scripts on a Debian x86_64 host with official-host access:

```bash
pnpm needle:bootstrap
NEEDLE_HOME="$HOME/.local/share/trueforge/needle" pnpm needle:introspect
NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:smoke --model "$NEEDLE_HOME/model/needle3.cact"
NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:service
curl --fail http://127.0.0.1:8792/health
pnpm needle:retrieval
NEEDLE_EVAL_CLIENT_MODULE="$PWD/deploy/needle/adapter/live-evaluation.mjs" pnpm eval:needle-live -- --runs 1 --timeout-ms 3000
NEEDLE_EVAL_CLIENT_MODULE="$PWD/deploy/needle/adapter/live-evaluation.mjs" pnpm eval:needle-live -- --runs 5 --timeout-ms 3000
HF_HUB_OFFLINE=1 NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:service
HF_HUB_OFFLINE=1 NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:smoke --offline --model "$NEEDLE_HOME/model/needle3.cact"
```

The production adapter assumptions are isolated in `service/backend.py`. Confirm them with `needle:introspect` before
starting the service, and adjust only that boundary if the installed signatures differ; HTTP contracts must remain stable.

## Real-runtime gate

- [x] official package download
- [x] wheel hash verification
- [x] engine download and hash
- [x] model download and hash
- [x] package import
- [x] real API introspection
- [x] model load
- [x] complete smoke test
- [x] reset smoke test
- [x] embed smoke test
- [x] extract smoke test
- [x] retrieval benchmark with real vectors
- [x] service with real backend
- [x] cold restart
- [x] `HF_HUB_OFFLINE=1` restart
- [x] one-run live evaluator
- [x] five-run live evaluator

## September 2026 empirical results

- Structured completion proposed `git_status` without executing it at confidence 1.0. Reset restored the same call as a
  fresh agent. Embeddings were finite, unit-normalized, stable across identical inputs, and 3,072-dimensional.
- The four-fixture retrieval benchmark achieved 100% top-1 and top-3 recall with no embedding errors. This small fixture
  result does not establish production retrieval quality; the high `git status` to `delete branch` cosine of 0.9193
  requires a broader safety-oriented corpus before enabling retrieval.
- Extraction exposed no native confidence and returned incorrect owner/repository fields for the required pull-request
  fixture. Keep Needle argument extraction in fallback-only mode.
- Five live classification runs within one process produced identical outputs, but every prediction was `simple/read`: exact-pair accuracy
  26.19%, complexity accuracy 42.86%, and action-class accuracy 33.33%. There were 16 unsafe `simple/read`
  misclassifications per run. A clean post-restart one-run evaluation had the same accuracies, no provider failures, one
  wrong prediction at confidence 0.95 or greater, and none at 0.99 or greater. Classification and shadow admission are
  not suitable for active routing.
- In the five-run process, the configured 0.95 shadow threshold admitted nothing, producing no unsafe admissions and six
  false ineligible cases per run. A clean one-run evaluation after restart admitted one false-eligible but non-unsafe
  request because confidence shifted across the threshold. Lower replay thresholds admitted unsafe requests.
  `toolsAvailable` did not change results.
- A cached offline restart reached ready in 10.687 seconds and served classification, embedding, and extraction without
  acquisition. Serialized inference prevented concurrent native access, but queued classification/extraction requests can
  exceed the three-second gateway timeout; a timed-out caller followed immediately by another request can time out again.

Active fast-path routing, model bypass, automatic approval, classification-based authorization, and Needle-owned tool
execution are explicitly out of scope.
