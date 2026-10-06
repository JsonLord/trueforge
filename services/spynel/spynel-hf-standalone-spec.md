# SPEC — Standalone Spynel on Hugging Face with Remote OpenCode ACP

## 0. Mission

Deploy **Spynel as a standalone orchestration service on a Hugging Face Docker Space** and make it capable of controlling remote OpenCode workers through the already-built Windows ACP gateway.

The target deployment is:

```text
Human
  |
  +--> Telegram
  |
  +--> WhatsApp (optional)
  |
  v
Hugging Face Docker Space
+--------------------------------------------------+
| Spynel                                           |
|                                                  |
| - durable orchestration state                    |
| - profile / workspace routing                    |
| - task + goal management                         |
| - channel integrations                           |
| - worker status synthesis                        |
|                                                  |
| local ACP harness command                        |
|        |                                         |
|        v                                         |
| spynel-remote-acp (stdio <-> WSS bridge)         |
+-----------------------+--------------------------+
                        |
                        | WSS
                        | Authorization: Bearer ...
                        v
Windows OpenCode Gateway
    /acp
      |
      +--> spawn `opencode acp`
               |
               v
         target workspace
```

Spynel must remain the orchestration layer. The Windows gateway remains a transport/security boundary. OpenCode remains the coding worker.

Do **not** move OpenCode into the Hugging Face Space.

---

# 1. Design principles

## 1.1 Standalone Spynel

The Hugging Face deployment must run Spynel independently of Agent Zero.

The deployment must not require:

- Agent Zero server;
- Agent Zero profiles;
- Agent Zero internal APIs;
- a co-located coding harness;
- OpenCode installed in the Space;
- a GPU.

Spynel is the host/orchestrator.

Remote coding harnesses are reached through local shim commands.

## 1.2 Transport boundary

Spynel should continue believing that an ACP harness is a normal local stdio command.

Do not rewrite Spynel's ACP protocol implementation merely to support remote OpenCode.

Instead introduce a tiny local executable:

```text
spynel-remote-acp
```

whose contract is:

```text
stdin  -> WebSocket -> remote gateway -> opencode acp
stdout <- WebSocket <- remote gateway <- opencode acp
```

This keeps the Spynel harness abstraction unchanged or minimally changed.

## 1.3 Protocol transparency

The remote ACP shim must not understand OpenCode semantics.

It may handle:

- WebSocket lifecycle;
- authentication headers;
- newline framing;
- bounded buffering;
- reconnect/error reporting;
- process exit codes.

It must not:

- rewrite JSON-RPC IDs;
- modify prompts;
- modify ACP methods;
- inspect tool calls for policy decisions;
- fabricate ACP responses;
- silently retry state-changing ACP messages.

## 1.4 Orchestration principle

Spynel controls:

- destination;
- profile;
- workspace;
- constraints;
- acceptance criteria;
- evidence expectations;
- intervention points.

Worker harnesses control their execution path.

For substantial work, prefer durable goal ownership over repeated low-level steering.

---

# 2. Repository inspection before implementation

Before changing code, inspect the current Spynel repository and identify:

- harness catalog;
- ACP adapter;
- custom ACP command support;
- harness command configuration;
- session persistence;
- task/goal persistence already present upstream;
- Telegram integration;
- WhatsApp integration;
- TUI startup assumptions;
- configuration loading;
- environment-variable handling;
- state directory selection;
- CLI entrypoints;
- foreground/background service behavior;
- signal handling;
- logging;
- health/server surfaces if any;
- current Docker or container assets;
- tests around ACP aliases and custom ACP commands.

Do not assume the repository shape from prior versions.

Reuse native abstractions wherever possible.

---

# 3. Hugging Face deployment mode

Add a documented and tested deployment mode suitable for a Hugging Face Docker Space.

The Space should:

- run as non-root;
- listen on the Hugging Face assigned/public port (normally 7860);
- keep the main process alive;
- expose a tiny HTTP health surface;
- start Spynel orchestration automatically;
- not require an interactive TTY;
- allow Telegram and/or WhatsApp to be the human-facing control channel;
- persist mutable state under a configurable data directory;
- recover state after ordinary process restarts when persistent storage is available;
- fail clearly if required secrets are missing.

Add an explicit service/headless mode if Spynel currently assumes an interactive terminal.

Conceptually:

```text
spynel serve
```

or reuse a native existing non-interactive mode if one exists.

Do not create a second orchestration runtime beside Spynel.

---

# 4. Hugging Face HTTP health server

The Space must expose an HTTP server on:

```text
0.0.0.0:${PORT:-7860}
```

Minimum endpoints:

```text
GET /healthz
GET /readyz
GET /status
```

## `/healthz`

Unauthenticated, minimal:

```json
{"status":"ok"}
```

It must reveal no secrets, remote URLs, tokens, workspace paths, chat IDs, or internal prompts.

## `/readyz`

Return success only when the Spynel service is initialized sufficiently to accept configured channel traffic.

It may report high-level booleans such as:

```json
{
  "status": "ready",
  "spynel": true,
  "state": true,
  "channels": true
}
```

Do not make readiness depend on every remote worker being online.

## `/status`

Authenticated or disabled by default.

May expose safe operational state such as:

- Spynel version;
- uptime;
- configured profile count;
- configured workspace count;
- active worker-session count;
- remote target health summary without secret URLs;
- last successful heartbeat time.

Never expose secrets.

---

# 5. Persistent data

Introduce one canonical configurable data root:

```text
SPYNEL_DATA_DIR=/data/spynel
```

Use existing Spynel persistence paths underneath it where possible.

Persist:

- Spynel configuration that is safe to persist;
- task state;
- goal state;
- session metadata;
- profile/workspace registry;
- channel routing state;
- worker-result summaries;
- durable markdown task artifacts;
- logs if appropriate and bounded.

Do not persist secrets into repository files or generated state snapshots.

Secrets must come from environment variables / Hugging Face Secrets.

If the Space has no persistent storage, startup must still work but log a clear warning that state is ephemeral.

---

# 6. Remote ACP shim

Create a small executable/module, for example:

```text
cmd/spynel-remote-acp
```

or the repository-native equivalent.

Its job:

```text
Spynel ACP stdio
      |
      v
spynel-remote-acp
      |
      | WSS
      v
remote /acp gateway
```

## Required configuration

Support environment variables or equivalent config:

```text
SPYNEL_REMOTE_ACP_URL
SPYNEL_REMOTE_ACP_TOKEN
SPYNEL_REMOTE_ACP_CONNECT_TIMEOUT_MS
SPYNEL_REMOTE_ACP_IDLE_TIMEOUT_MS
SPYNEL_REMOTE_ACP_MAX_MESSAGE_BYTES
SPYNEL_REMOTE_ACP_TLS_INSECURE=false
```

Do not place the token in command-line arguments.

Default production expectation:

```text
SPYNEL_REMOTE_ACP_URL=wss://<gateway>/acp
```

Use:

```text
Authorization: Bearer <token>
```

during WebSocket connection.

## Input/output contract

stdin:

- newline-delimited ACP JSON-RPC from Spynel;
- each complete non-empty line becomes one WebSocket text message.

WebSocket -> stdout:

- each complete WebSocket text message becomes one newline-delimited stdout record.

stderr:

- local shim diagnostics only;
- never mix diagnostics into stdout ACP traffic.

## Error behavior

If connection cannot be established:

- write concise diagnostic to stderr;
- exit non-zero.

If the remote WebSocket closes:

- close stdout naturally;
- exit non-zero for abnormal closure;
- use zero only for clean intentional shutdown if appropriate.

If stdin closes:

- initiate clean WebSocket close;
- exit promptly.

Do not reconnect transparently after ACP traffic has begun unless repository semantics prove this is safe.

A reconnect could duplicate or corrupt session semantics.

Fail closed instead.

---

# 7. Remote ACP security

The shim must:

- require `wss://` by default for non-local targets;
- reject plain `ws://` for public/remote hosts unless an explicit development override exists;
- never log the bearer token;
- never include the token in panic/error dumps;
- never echo all environment variables;
- enforce maximum message sizes;
- bound queues and buffers;
- reject binary frames unless explicitly supported;
- validate basic WebSocket text framing;
- optionally validate JSON syntax without interpreting ACP semantics.

`SPYNEL_REMOTE_ACP_TLS_INSECURE=true` must be an explicit development-only opt-in with a warning.

---

# 8. Harness registration

Add a Spynel harness profile/alias for the remote OpenCode worker without duplicating the ACP protocol adapter.

Preferred shape:

```yaml
harnesses:
  remote-opencode:
    type: acp
    command: spynel-remote-acp
```

or the closest native Spynel equivalent.

The local command executed by Spynel should be the remote shim.

Do not make Spynel call `opencode acp` directly on Hugging Face.

Do not require OpenCode to be installed in the Space.

If the current catalog supports custom ACP commands cleanly, use that path instead of hardcoding a new provider.

---

# 9. Multi-target registry

Prepare standalone Spynel for more than one remote execution target.

Add a configuration file following repository conventions, for example:

```text
config/remotes.yaml
```

Conceptually:

```yaml
remotes:
  windows-opencode:
    kind: acp
    harness: remote-opencode
    endpoint_env: OPENCODE_WINDOWS_ACP_URL
    token_env: OPENCODE_WINDOWS_ACP_TOKEN
    tags:
      - local
      - windows
      - desktop
      - opencode
    capabilities:
      - coding
      - browser
    enabled: true

  debian-opencode:
    kind: acp
    harness: remote-opencode
    endpoint_env: OPENCODE_DEBIAN_ACP_URL
    token_env: OPENCODE_DEBIAN_ACP_TOKEN
    tags:
      - local
      - debian
      - server
      - opencode
    enabled: false
```

Important:

- URLs and tokens referenced by env name;
- secret values never committed;
- disabled entries safe;
- invalid entries fail with precise diagnostics;
- user chat input cannot inject arbitrary endpoints.

Exact schema may be adapted to native config abstractions.

---

# 10. Profile and workspace routing

Standalone Spynel needs three distinct concepts:

```text
task placement
    ->
profile
    ->
workspace / execution target
```

## First selector: placement intent

Allow explicit user hints such as:

```text
#hosted
#local
```

Interpretation:

- `#hosted` = prefer hosted/cloud execution target;
- `#local` = prefer user-controlled/local infrastructure.

Remove the tag from worker-facing prompt content after it has influenced routing.

Do not rely only on tags; default routing policy may decide when absent.

## Profile selection

Profile defines the role/persona/capability required.

Examples:

- developer;
- tester;
- reviewer;
- researcher;
- debugger.

Use existing Spynel profiles if already present.

Do not create Agent Zero profiles in this standalone deployment.

## Workspace selection

After profile selection, choose the execution environment/workspace.

Conceptually:

```text
Windows desktop
Debian server
DGX
hosted remote worker
```

The workspace registry should declare:

- target ID;
- remote/harness ID;
- workspace name;
- safe root or predefined cwd;
- tags;
- capabilities;
- enabled state;
- concurrency limit.

Clients must not provide arbitrary filesystem paths.

---

# 11. Initial routing implementation

Do not overbuild an AI router in the first hosting PR.

Implement deterministic routing interfaces first.

Support:

1. explicit route/workspace if user or internal caller specifies a known ID;
2. `#hosted` / `#local`;
3. profile capability requirements;
4. enabled targets;
5. concurrency/capacity;
6. stable fallback order.

Keep a clean hook/interface for the previously planned Laya decision layer, but Laya integration is not required to prove standalone hosting unless it already exists in the branch.

No routing decision may invent:

- a profile;
- a workspace;
- an endpoint;
- a secret env variable.

---

# 12. Channel behavior

The Hugging Face host is intended to be operated without a terminal UI.

Support at least the existing Telegram integration in headless/service mode.

Preserve WhatsApp integration if present.

## Telegram mode

Desired future behavior:

```text
one input/control chat
    ->
Spynel routes task
    ->
worker/session gets distinct continuation surface where supported
```

If Telegram thread/chat creation cannot be done natively, preserve session IDs and provide deterministic commands/links for continuing sessions.

Do not block hosting work on advanced Telegram thread creation.

## WhatsApp mode

Treat WhatsApp as a single combined user-facing control channel unless the native integration already supports richer session separation.

---

# 13. Durable goals for long-running work

Preserve and strengthen Spynel's native goal/task concepts rather than creating Agent Zero-specific goal APIs.

For a substantial multi-step request, Spynel should create or own a durable goal containing conceptually:

```yaml
goal_id: goal_...
title: ...
objective: ...
success_criteria: []
constraints: []
evidence_required: []
profile: developer
workspace: windows-opencode
state: active
current_milestone: ...
progress_revision: 1
requires_attention: false
created_at: ...
updated_at: ...
```

Adapt exact fields to existing Spynel models.

Do not build a separate project-management database.

---

# 14. Goal semantics

Use the following conceptual distinction:

```text
/message
    = immediate bounded operation

profile
    = who should perform it

workspace
    = where it should execute

/goal
    = durable outcome owned until complete, blocked, paused,
      cancelled, failed, or revised
```

A goal is not just another chat prompt.

It needs durable structured state.

If upstream Spynel already has equivalent task/goal abstractions, extend those instead of adding incompatible commands.

---

# 15. Goal commands

If native equivalents do not already exist, support or map:

```text
/goal set
/goal show
/goal status
/goal checkpoint
/goal revise
/goal pause
/goal resume
/goal complete
/goal cancel
```

Optional:

```text
/goal subgoal
```

The implementation must work without the TUI being open.

Channel-driven Spynel must be able to use the same operations.

---

# 16. Compact worker context

When Spynel launches or resumes a worker for a durable goal, send a compact execution envelope:

```text
ACTIVE GOAL

Objective:
...

Current milestone:
...

Remaining success criteria:
...

Constraints:
...

Evidence required:
...

Workspace:
...

Continue autonomously.
Return attention only for a meaningful checkpoint,
blocker, approval requirement, security boundary,
scope expansion, repeated failure, or completion.
```

Do not repeatedly replay the entire management conversation.

---

# 17. Worker narration policy

For long-running goals, avoid constant parent-facing narration.

A worker may internally:

```text
inspect
edit
test
fail
debug
edit
test
commit
```

without Spynel relaying every low-level step.

Surface:

- meaningful checkpoint;
- blocker;
- approval request;
- scope change;
- failure;
- completion.

This is especially important when workers are remote and every turn crosses the ACP gateway.

---

# 18. Semantic progress model

Each durable goal should expose a semantic:

```text
progress_revision
```

Increment it only for meaningful state changes such as:

- milestone start/completion;
- blocker discovered;
- evidence added;
- dependency change;
- approval required;
- completion/failure.

Do not increment it for every ACP event or shell/tool call.

---

# 19. Attention contract

Every long-running goal/status should expose:

```yaml
requires_attention: false
```

When true, expose a machine-readable reason, for example:

```text
approval_required
ambiguous_requirement
scope_expansion
external_credential_needed
repeated_failure
security_boundary
conflicting_evidence
manual_action_required
worker_unreachable
remote_transport_failed
```

When `requires_attention=false`, normal orchestration behavior is to leave the worker alone.

---

# 20. Remote worker status synthesis

Spynel should synthesize worker results before sending them to the human channel.

Preferred completion/checkpoint summary:

```yaml
goal_id: ...
profile: developer
workspace: windows-opencode
state: completed

outcome:
  ...

changes:
  - ...

evidence:
  tests:
    passed: ...
    failed: ...
  commit: ...

risks: []

requires_attention: false
```

Do not send entire raw terminal/ACP transcripts by default.

Keep detailed logs available for inspection.

---

# 21. Evidence-based completion

A goal should not be marked fully complete merely because a worker says "done".

Evaluate success criteria and evidence.

Conceptual final review:

```text
PASS
- criterion
  evidence: ...

NOT VERIFIED
- criterion
  reason: ...

FAIL
- criterion
  evidence: ...
```

Allowed final states may include native equivalents of:

```text
completed
partially_verified
blocked
failed
cancelled
```

Do not label required FAIL or NOT VERIFIED criteria as complete unless the goal contract explicitly permits it.

---

# 22. Remote transport failure behavior

A remote ACP failure must not create duplicate work automatically.

If:

- WSS disconnects;
- the gateway closes;
- worker process dies;
- target becomes unreachable;

then:

1. preserve the Spynel goal/session record;
2. mark transport/interruption state;
3. do not silently start a second worker;
4. expose `requires_attention` when human action is genuinely required;
5. allow deliberate resume/retry.

If the native ACP session cannot be resumed safely through a new gateway process, make that limitation explicit.

---

# 23. Idempotency

Long-running operations and remote dispatch must tolerate network uncertainty.

Where practical use:

```text
goal_id
session_id
dispatch_id
idempotency_key
```

A retry caused by an HTTP/channel timeout must not create two identical Spynel goals or two duplicate workers.

Add regression tests.

---

# 24. Concurrency and resource limits

Add conservative configuration for:

```text
SPYNEL_MAX_ACTIVE_WORKERS
SPYNEL_MAX_ACTIVE_GOALS
SPYNEL_MAX_WORKERS_PER_REMOTE
SPYNEL_MAX_GOAL_DEPTH
SPYNEL_MAX_CHILD_GOALS
```

Reuse native concurrency controls where possible.

Do not allow recursive autonomous worker spawning to exhaust the HF Space or remote gateway.

A remote target declaration may have its own concurrency limit matching gateway capacity.

---

# 25. Docker Space packaging

Add Hugging Face Docker deployment assets.

Preferred deliverables:

```text
Dockerfile
README-HF.md or deployment section
.env.example / config examples
health server integration
```

Requirements:

- CPU-only base image;
- minimal image size;
- non-root runtime where feasible;
- no Docker-in-Docker;
- no systemd dependency;
- install only runtime dependencies;
- build Spynel during image build if needed;
- expose port 7860;
- use one deterministic entrypoint;
- graceful signal handling;
- no secret baked into image layers.

If Spynel has an official binary/release path, prefer repository-native build conventions over unnecessary npm wrapping.

---

# 26. Hugging Face secrets

Document required Space Secrets using names, never values.

At minimum for the first Windows OpenCode target:

```text
OPENCODE_WINDOWS_ACP_URL
OPENCODE_WINDOWS_ACP_TOKEN
```

For Telegram if used:

```text
TELEGRAM_BOT_TOKEN
```

Add existing native Spynel secret names rather than inventing duplicates when they already exist.

Optional later targets should be represented by their own URL/token env names.

---

# 27. Config example for first deployment

Provide a complete example configuration that routes a developer profile to the Windows OpenCode gateway.

Conceptually:

```yaml
profiles:
  developer:
    harness: remote-opencode
    default_workspace: windows-main

remotes:
  windows-opencode:
    endpoint_env: OPENCODE_WINDOWS_ACP_URL
    token_env: OPENCODE_WINDOWS_ACP_TOKEN
    max_concurrency: 4

workspaces:
  windows-main:
    remote: windows-opencode
    tags:
      - local
      - windows
      - coding
```

Adapt to actual Spynel config conventions after inspection.

Do not invent incompatible YAML if the repository uses another format.

---

# 28. Remote ACP shim tests

Add deterministic tests for:

- valid WSS connection setup;
- bearer header sent;
- token never logged;
- stdin line -> one WebSocket message;
- multiple stdin lines;
- fragmented stdin buffering if needed;
- WebSocket message -> stdout newline;
- stderr remains separate;
- binary frame rejection;
- oversized frame rejection;
- abnormal remote close -> non-zero exit;
- stdin EOF -> clean socket close;
- connection timeout;
- TLS insecure override only when explicit;
- no automatic semantic replay/reconnect;
- bounded queues/backpressure.

Use a local mock WebSocket server.

Normal unit tests must not require the real Windows gateway.

---

# 29. Spynel integration tests

Add tests proving:

```text
Spynel ACP adapter
   ->
remote shim
   ->
mock WSS gateway
   ->
synthetic ACP server
```

Test at least:

1. initialize round-trip;
2. session/new or equivalent supported lifecycle;
3. prompt request reaches synthetic ACP worker;
4. streamed result reaches Spynel;
5. cancellation/close propagates;
6. abnormal remote disconnect does not spawn duplicate worker.

No real model calls required.

---

# 30. Optional live gateway smoke test

Add an opt-in command/env-gated test against the real Windows `/acp` endpoint.

Example:

```text
npm/run/go test command or script
```

It may:

- establish WSS;
- authenticate;
- perform ACP initialize;
- close cleanly.

It must not intentionally trigger paid/provider inference.

Skip cleanly when URL/token are absent.

---

# 31. Headless channel smoke tests

Where feasible add deterministic tests around:

- service startup without TTY;
- Telegram handler initialization with a fake adapter;
- inbound message -> Spynel routing;
- response/checkpoint -> outbound channel adapter;
- no terminal UI dependency.

Do not require a real Telegram account in normal CI.

---

# 32. Security invariants

The final implementation must preserve all of these:

- OpenCode is not installed or exposed on the HF host merely for remote ACP.
- Remote gateway token is never printed.
- User messages cannot set arbitrary ACP URLs.
- User messages cannot set arbitrary local executables.
- User messages cannot set arbitrary filesystem paths on remote workers.
- `shell: true` is not used for the remote shim.
- Secrets are environment-backed.
- `/healthz` reveals no secrets.
- service does not trust arbitrary forwarded headers for authorization.
- WSS is the production default.
- reconnect never duplicates an ACP request silently.
- remote transport failure does not create duplicate worker sessions.
- no production action bypasses explicit approval boundaries.

---

# 33. Preserve upstream Spynel behavior

Do not regress:

- TUI usage;
- local Codex;
- local Claude Code;
- local OpenCode ACP;
- other ACP aliases;
- task management;
- Telegram;
- WhatsApp;
- existing config compatibility;
- existing session resume semantics;
- existing security boundaries.

Remote OpenCode must be additive.

---

# 34. Documentation

Update the repository documentation with:

## Standalone HF architecture

```text
Telegram/WhatsApp
       |
       v
HF Spynel
       |
       v
remote ACP shim
       |
       v
Windows /acp gateway
       |
       v
opencode acp
```

## Local development

Explain how to use a mock WSS ACP target.

## Production secrets

List required environment variable names.

## Remote target configuration

Explain predefined target IDs and why arbitrary URLs are prohibited.

## Persistence

Explain the difference between ephemeral HF disk and persistent storage.

## Failure/recovery

Explain what happens when the gateway or worker disconnects.

## Security

Explain token handling and WSS requirements.

---

# 35. Acceptance gates

Do not stop at "it builds".

The work is accepted only when there is evidence for all applicable gates.

## Gate A — repository compatibility

- existing Spynel tests pass;
- local harness behavior preserved.

## Gate B — remote ACP shim

- deterministic bridge tests pass;
- initialize round-trip passes against synthetic ACP server.

## Gate C — Spynel integration

- Spynel launches remote shim as ACP command;
- synthetic prompt lifecycle succeeds;
- abnormal disconnect handled without duplicate dispatch.

## Gate D — headless hosting

- service starts without TTY;
- health endpoint returns 200;
- readiness behaves correctly.

## Gate E — Docker/HF

- Docker image builds;
- container starts non-interactively;
- port 7860 responds;
- no secrets baked into image.

## Gate F — persistence

- persisted goal/task/session metadata survives a controlled restart when persistent data dir is available.

## Gate G — live gateway optional evidence

If real Windows gateway credentials are available:

- authenticated WSS `/acp` connection succeeds;
- ACP initialize succeeds;
- socket closes cleanly.

Do not require model inference.

---

# 36. Deliverables

Implement the work, not merely a design.

Deliver at least:

1. standalone/headless Spynel service mode or validated native equivalent;
2. Hugging Face Dockerfile;
3. health/readiness surface;
4. `spynel-remote-acp` stdio<->WSS bridge;
5. remote target configuration;
6. Windows OpenCode target example;
7. profile/workspace routing config foundation;
8. durable goal behavior integrated with native Spynel primitives;
9. persistence configuration;
10. deterministic tests;
11. optional live ACP smoke test;
12. deployment documentation;
13. `.env.example` / secrets documentation.

---

# 37. Final implementation report

Before asking for PR creation, report:

## A. Architecture
- final process topology;
- service/headless mode;
- health server.

## B. Remote ACP bridge
- files;
- framing;
- auth;
- backpressure;
- failure semantics.

## C. Spynel harness integration
- how Spynel launches the shim;
- how local OpenCode remains unaffected.

## D. Remote registry
- schema;
- secret references;
- validation.

## E. Routing
- task placement;
- profile selection;
- workspace selection;
- deterministic fallback.

## F. Goals
- native goal/task reuse;
- progress revisions;
- attention states;
- evidence-based completion.

## G. Persistence
- data root;
- restart behavior;
- ephemeral-storage warning.

## H. Hugging Face
- image build;
- entrypoint;
- port;
- runtime user;
- secrets required.

## I. Tests
Give exact test commands and counts for:
- existing regression tests;
- remote ACP shim tests;
- Spynel integration tests;
- hosting/health tests;
- idempotency tests.

## J. Security
Explicitly verify every security invariant in this spec.

## K. Live validation
Report what was and was not proven against the real Windows gateway.

## L. Remaining limitations
Especially:
- remote session resume constraints;
- HF persistent-storage assumptions;
- Telegram/WhatsApp provider-specific limitations.

Also include:

```text
git status --short
git diff --stat
```

Do not create a PR until the implementation and pre-PR evidence report are complete.

---

# 38. Target end state

```text
USER
  |
  +---- Telegram / WhatsApp
  |
  v
SPYNEL ON HUGGING FACE
  |
  | outcome + constraints + routing
  |
  +----> profile
  |
  +----> workspace
  |
  v
LOCAL REMOTE-ACP SHIM
  |
  | authenticated WSS
  v
REMOTE GATEWAY
  |
  | stdio
  v
OPENCODE ACP
  |
  | autonomous execution
  v
EVIDENCE / CHECKPOINT
  |
  v
SPYNEL SYNTHESIS
  |
  v
USER
```

Architectural principle:

> Spynel owns the destination, boundaries, evidence expectations, and intervention points. The remote worker owns the route.
