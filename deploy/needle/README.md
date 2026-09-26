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

Not yet. The current environment's HTTPS proxy rejects CONNECT requests to the required official upstream hosts with
HTTP 403. The externally verified pins below are an implementation contract, not a claim of local execution.

## Pins and storage

- Package: `cactus-needle==3.0.5`
- Wheel: `cactus_needle-3.0.5-py3-none-any.whl`
- Wheel SHA-256: `3987dd18f7fdd4954b92e75e8be08c37ccd0b1f898ed19a1267770cf1be20816`
- Publishing source: `42bf1f2d0a7784b0d4d1ec94bb5ade425cf9a67c`
- Model: `Cactus-Compute/needle3@3e8e2a66057a29694052d915128b91b53e7e5ead`
- Model file: `needle3.cact`, 35,335,380 bytes
- Model SHA-256: `c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38`
- Engine platform: `manylinux2014_x86_64`, acquired with the official `needle fetch` command

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
NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:smoke -- --model "$NEEDLE_HOME/model/needle3.cact"
NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:service
curl --fail http://127.0.0.1:8792/health
pnpm needle:retrieval
NEEDLE_EVAL_CLIENT_MODULE="$PWD/deploy/needle/adapter/live-evaluation.mjs" pnpm eval:needle-live -- --runs 1 --timeout-ms 3000
NEEDLE_EVAL_CLIENT_MODULE="$PWD/deploy/needle/adapter/live-evaluation.mjs" pnpm eval:needle-live -- --runs 5 --timeout-ms 3000
HF_HUB_OFFLINE=1 NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:service
HF_HUB_OFFLINE=1 NEEDLE3_LIB_PATH=/verified/path/libneedle.so pnpm needle:smoke -- --offline --model "$NEEDLE_HOME/model/needle3.cact"
```

The production adapter assumptions are isolated in `service/backend.py`. Confirm them with `needle:introspect` before
starting the service, and adjust only that boundary if the installed signatures differ; HTTP contracts must remain stable.

## Real-runtime gate

- [ ] official package download
- [ ] wheel hash verification
- [ ] engine download and hash
- [ ] model download and hash
- [ ] package import
- [ ] real API introspection
- [ ] model load
- [ ] complete smoke test
- [ ] reset smoke test
- [ ] embed smoke test
- [ ] extract smoke test
- [ ] retrieval benchmark with real vectors
- [ ] service with real backend
- [ ] cold restart
- [ ] `HF_HUB_OFFLINE=1` restart
- [ ] one-run live evaluator
- [ ] five-run live evaluator

Active fast-path routing status: **BLOCKED BY CLASSIFIER VALIDATION FAILURE**.
Model bypass, automatic approval, classification-based authorization, and Needle-owned tool execution are strictly forbidden.

> **WARNING:** Needle 3 request classification failed the TrueForge safety evaluation and MUST NOT be used for routing,
> authorization, approval suppression, or fast-path admission.
>
> Status: **FAILED — NOT SUITABLE FOR ROUTING**
>
> - Five-run predictions were universally `simple + read`;
> - Writes, destructive, and external-side-effect requests were underclassified;
> - 16 unsafe simple/read errors occurred per run;
> - Confidence is not semantically reliable;
> - Process restart changed confidence enough to alter admission behavior.
>
> Needle classifier may remain available ONLY for evaluation/research/debug metadata, NOT runtime authority.

### Capability Status Matrix

- **Needle Request Classification**: `requestClassificationEnabled = false` (default). Status: **FAILED — NOT SUITABLE FOR ROUTING**.
- **Needle Argument Extraction**: `argumentExtractionEnabled = false` (default). Status: **IMPLEMENTED, RUNTIME VERIFIED, SEMANTIC QUALITY FAILED, FALLBACK-ONLY**.
- **Needle Active Fast Path**: Status: **BLOCKED BY CLASSIFIER VALIDATION FAILURE**.
- **Needle Embedding Retrieval**: `enabled = false` (default). Production Hypothesis: `embedding-based ToolSelectorPolicy candidate reduction`. Non-authoritative, fail-open, unable to broaden tools, unable to execute, unable to approve, unable to remove security checks.

### Capability-Specific Service Usage Guidelines

- `/v1/embed`: Candidate for runtime use if production retrieval evaluation passes.
- `/v1/classify`: Evaluation / research / debug metadata only. MUST NOT be used for active routing, authorization, approval suppression, or fast-path admission.
- `/v1/extract`: Experimental / fallback-only.

Operation timing metrics (`queueWaitMs`, `executionMs`, `totalMs`) are tracked per serialized gateway call while maintaining strict single-worker inference serialization for safety.
