# Spynel Multi-Agent Routing, Laya Decision Layer, Placement, AGTX Status, and Session Channels

Status: implementation specification  
Target repository: `https://github.com/JsonLord/spynel`  
Primary implementation language: Go  
Configuration format: YAML  
Primary routing philosophy: deterministic first, Laya only where semantic judgment is useful  
Compatibility requirement: existing single-harness Spynel behavior must continue to work when the new routing configuration is absent or disabled.

---

## 1. Objective

Extend Spynel from a primarily single-workspace/single-harness communication and orchestration layer into a lightweight multi-agent switchboard capable of:

1. receiving one user message from TUI, CLI, WhatsApp, or Telegram;
2. applying explicit user routing hints such as `#local`, `#hosted`, `#dgx`, `#debian`, `#hf`, `#auto`, `@coder`, `@research`, or a concrete worker target;
3. choosing the correct logical agent profile;
4. using the hosted Laya System-1 service for ambiguous semantic routing decisions;
5. resolving the correct project workspace and execution target separately from profile selection;
6. delegating uncertain placement questions to a cheap read-only placement-research agent on Debian;
7. dispatching the chosen worker locally, over SSH, or through an HTTP/hosted adapter;
8. preserving conversation/session affinity so follow-up messages return to the correct running agent;
9. collecting the worker result and producing a concise completion/achievement report;
10. publishing execution status into a self-hosted AGTX board;
11. returning the completion report to the user through the active communication mode;
12. supporting two user-facing communication modes:
    - WhatsApp consolidated mode: one WhatsApp conversation for all control and results.
    - Telegram session mode: one private bot inbox/General thread for new work and one private forum topic per dispatched agent session, allowing each session to continue independently. A forum-enabled supergroup remains an optional fallback deployment.

The system must remain lightweight. Spynel should make deterministic decisions wherever enough structured information exists and only call Laya or the placement researcher when needed.

---

## 2. Design principles

### 2.1 Separate semantic routing from infrastructure placement

Do not collapse all routing into one "agent selector".

The decision pipeline is:

```text
MESSAGE
  |
  v
PARSE EXPLICIT ROUTING HINTS
  |
  v
EXECUTION POLICY / DOMAIN
  |
  v
PROFILE ROUTING
  |
  v
WORKSPACE RESOLUTION
  |
  v
PLACEMENT RESOLUTION
  |
  v
WORKER SELECTION
  |
  v
HARNESS / TRANSPORT
  |
  v
EXECUTION
  |
  v
COMPLETION NORMALIZATION
  |
  +----> USER CHANNEL
  |
  +----> AGTX STATUS SINK
```

Use the following terminology consistently:

- **Execution policy**: broad constraint from the task or user, e.g. local, hosted, remote, DGX.
- **Profile**: semantic type of agent needed, e.g. research, coder-fast, coder-deep, reviewer.
- **Workspace**: logical project/repository/state context in which work belongs.
- **Target**: machine or hosting environment such as Debian, DGX, Windows gateway, Hugging Face.
- **Worker**: concrete agent instance combining profile + target + harness/transport configuration.
- **Placement resolver**: chooses workspace + target + worker after profile selection.
- **Laya**: semantic System-1 router; normally chooses a profile, not a machine.
- **Placement researcher**: read-only agent used only when target/workspace requirements cannot be safely resolved deterministically.

### 2.2 Explicit routing always wins

Explicit user routing must never be overridden by Laya.

Examples:

```text
#dgx @coder debug the CUDA failure
#hosted @research compare these crawling projects
@review inspect the current pull request
#local fix this service
```

Interpretation:

- `#...` constrains execution domain or target.
- `@...` selects a profile or concrete worker.
- untagged messages use affinity/rules/Laya.

### 2.3 Laya is not the orchestrator

Laya must not execute tasks, choose SSH commands, mutate files, choose credentials, or decide health/load.

Laya answers only semantic questions such as:

> Which eligible profile best matches this message?

Spynel remains the deterministic controller.

### 2.4 Placement is evidence-driven

Choosing Debian vs DGX vs hosted compute may depend on:

- repository location;
- filesystem/data locality;
- required services;
- CPU/RAM/GPU requirement;
- tool availability;
- live service location;
- SSH reachability;
- endpoint health;
- current worker capacity;
- current conversation affinity;
- existing worktree/session state.

If those facts are already known, resolve placement deterministically.

If material facts are unknown, call the read-only Debian placement researcher and then make the final placement decision in Spynel.

### 2.5 Fail open to safe defaults

Optional intelligence must not make Spynel unusable.

- Laya unavailable -> deterministic/default profile fallback.
- placement researcher unavailable -> deterministic placement or safe default/fail with actionable message.
- AGTX unavailable -> task still runs; queue or log status sync failure.
- Telegram forum creation unavailable -> fall back to same-chat session-marked replies unless configured to require forum topics.
- remote worker unavailable -> choose another eligible worker or report no eligible worker.

---

## 3. Existing Spynel boundaries to preserve

Spynel already has useful boundaries that must remain intact:

- channels convert native traffic into a transport-neutral message;
- application/orchestration code should stay harness-neutral;
- harness adapters translate provider-specific execution into a common interface;
- conversation/session follow-up semantics already exist;
- configuration is typed and validated;
- one primary process owns continuous orchestration and remote channels.

Do not move Telegram/WhatsApp-specific logic into the semantic router.

Do not make `core.Message` provider-specific.

Prefer an internal routing envelope around `core.Message`.

---

## 4. Proposed packages

Add packages approximately along these lines. Exact filenames may be adjusted to match current repository conventions.

```text
internal/
  agent/
    profile.go
    worker.go
    registry.go
    health.go
    selector.go

  routing/
    router.go
    parser.go
    decision.go
    affinity.go
    candidates.go
    policy.go
    workspace.go
    placement.go

    laya/
      client.go
      types.go

  placement/
    resolver.go
    researcher.go
    evidence.go

  reporting/
    completion.go
    summarizer.go
    sink.go

  integration/
    agtx/
      client.go
      mcp.go
      mapping.go
      sink.go

  harness/
    ... existing
    remote_http.go       # if needed
    ssh.go               # if needed
```

Prefer small interfaces and dependency injection so routing, Laya, placement, AGTX, and Telegram topic logic are testable with fake implementations.

---

## 5. Core routing types

Introduce provider-neutral internal types equivalent to:

```go
type ExecutionScope string

const (
    ScopeAuto   ExecutionScope = "auto"
    ScopeLocal  ExecutionScope = "local"
    ScopeHosted ExecutionScope = "hosted"
    ScopeRemote ExecutionScope = "remote"
)

type ExecutionPolicy struct {
    Scope            ExecutionScope
    RequiredTargets  []string
    PreferredTargets []string
    ExcludedTargets  []string
}

type RouteContext struct {
    ExplicitProfile  string
    ExplicitWorker   string
    ExplicitWorkspace string

    CurrentProfile   string
    CurrentWorker    string
    CurrentWorkspace string

    RouteSource      string
    Confidence       float64
}

type RouteDecision struct {
    ProfileID    string
    Source       string
    Confidence   float64
    ReasonCode   string
    Candidates   []string
}

type PlacementDecision struct {
    WorkspaceID string
    TargetID    string
    WorkerID    string
    Source      string
    Confidence  float64
    Evidence    []string
}

type DispatchEnvelope struct {
    Message     core.Message
    Policy      ExecutionPolicy
    Route       RouteDecision
    Placement   PlacementDecision
}
```

Do not persist hidden model reasoning. Persist only compact reason codes and concrete evidence.

---

## 6. Message syntax

### 6.1 Execution tags

Support these initial tags:

```text
#auto
#local
#hosted
#remote
#debian
#dgx
#windows
#hf
```

Semantics:

- `#auto`: normal automatic placement.
- `#local`: execution must remain on user-owned/local infrastructure.
- `#hosted`: execution must use hosted/cloud infrastructure.
- `#remote`: execution may use a remote machine accessed over network/SSH.
- `#debian`, `#dgx`, `#windows`, `#hf`: concrete target constraints.

Also support:

```text
#workspace:<workspace-id>
```

for explicit workspace pinning.

Tags are routing metadata and should be removed from the text passed to the worker unless a compatibility setting says otherwise.

### 6.2 Profile and worker mentions

Support:

```text
@coder
@research
@review
@browser
@coder-deep
```

for profiles and configured aliases.

Also allow concrete worker IDs:

```text
@coder-dgx
@spark-hf
@research-debian
```

Resolution rule:

1. exact worker ID;
2. alias;
3. exact profile ID;
4. otherwise leave as user text unless configured as an invalid-routing error.

The parser must not treat email addresses or ordinary `@` text as routing unless it matches a configured profile/worker/alias.

---

## 7. Routing precedence

Use this exact conceptual precedence:

```text
1. transport authorization/security
2. local Spynel slash/system commands
3. explicit # execution policy
4. explicit @ concrete worker
5. explicit @ profile
6. reply/thread binding to an existing agent session
7. active-turn/session affinity
8. active workspace affinity
9. orchestrator-defined workflow role
10. deterministic capability/rule match
11. Laya profile decision
12. configured default profile
```

Laya must never override stages 1-10.

---

## 8. Conversation and session affinity

Every dispatched agent session receives a durable Spynel session ID.

Maintain mappings:

```text
channel conversation/thread
    -> spynel session
    -> profile
    -> workspace
    -> target
    -> worker
    -> provider/harness thread ID
```

Follow-up behavior:

- reply to an existing Telegram agent topic -> same session by default;
- reply to a result message -> same session;
- untagged "ok fix it", "continue", "run tests again" -> same active session where confidence is high;
- explicit `@...`, `#...`, or `#workspace:...` may override affinity;
- `/route auto` clears a conversation-level pin;
- `/route <profile>` pins the conversation/topic to a profile;
- `/session new` starts a fresh session.

Reuse Spynel's existing provider follow-up/steering behavior where possible.

---

## 9. Profiles, targets, workspaces, and workers YAML

Add a canonical routing registry, preferably:

```text
.spynel/agents.yaml
```

Keep ordinary workspace configuration in `.spynel/config.yaml`; keep the growing registry separate.

No secrets may be stored directly unless existing Spynel secret conventions explicitly permit them. Prefer environment variable references.

Example:

```yaml
version: 1

routing:
  enabled: true
  default_profile: general
  max_laya_candidates: 5
  affinity_ttl_minutes: 120

  laya:
    enabled: true
    base_url: "https://leon4gr45-needle-router.hf.space"
    system_one_path: "/v1/system-one"
    health_path: "/health"
    ready_path: "/ready"
    info_path: "/v1/info"
    timeout_ms: 1800
    confidence_auto: 0.70
    confidence_fallback: 0.45
    api_token_env: ""

  placement:
    researcher_enabled: true
    researcher_worker: "placement-research-debian"
    timeout_seconds: 90
    require_read_only: true

aliases:
  coder: coder-fast
  deep: coder-deep
  review: reviewer
  web: browser

profiles:
  general:
    description: "General assistant, planning, clarification, and delegation."
    capabilities: ["general", "planning", "delegation"]

  coder-fast:
    description: "Routine repository inspection, implementation, tests, and small fixes."
    capabilities: ["code", "git", "tests", "shell"]

  coder-deep:
    description: "Architecture, difficult debugging, major refactors, and long-context engineering."
    capabilities: ["code", "architecture", "debugging", "git", "tests", "shell"]

  reviewer:
    description: "Independent code and PR review."
    capabilities: ["review", "git", "tests"]

  research:
    description: "Web/repository research and evidence gathering."
    capabilities: ["research", "web", "github"]

  browser:
    description: "Browser automation and user-journey work."
    capabilities: ["browser", "playwright", "web"]

  placement-research:
    description: "Read-only infrastructure and workspace placement investigation."
    capabilities: ["placement", "health", "repo-inspection", "telemetry"]
    internal: true

targets:
  debian:
    kind: local
    transport: native
    labels: ["cpu", "control-plane", "always-on"]
    health:
      type: local

  dgx:
    kind: remote
    transport: ssh
    labels: ["gpu", "high-memory", "cuda"]
    ssh:
      host_env: "SPYNEL_DGX_HOST"
      user_env: "SPYNEL_DGX_USER"
      key_path_env: "SPYNEL_DGX_SSH_KEY"
    health:
      type: ssh
      command: "printf ok"

  hf:
    kind: hosted
    transport: https
    labels: ["hosted", "space"]
    health:
      type: http

  windows:
    kind: local
    transport: http
    labels: ["desktop", "edge"]
    endpoint_env: "SPYNEL_WINDOWS_GATEWAY"

workspaces:
  spynel:
    repo: "JsonLord/spynel"
    locations:
      - target: debian
        path: "/mnt/ssd/projects/spynel"

  journeytest-core:
    repo: "JsonLord/journeytest-core"
    locations:
      - target: debian
        path: "/mnt/ssd/projects/journeytest-core"
      - target: hf
        remote: "Leon4gr45/nova-right-nav"

  mentor-runtime:
    repo: "JsonLord/mentor-runtime"
    locations:
      - target: debian
        path: "/mnt/ssd/projects/mentor-runtime"
      - target: dgx
        path: "/home/leon/mentor-runtime"

workers:
  general-debian:
    profile: general
    target: debian
    harness: acp
    max_jobs: 1
    priority: 80

  research-debian:
    profile: research
    target: debian
    harness: acp
    max_jobs: 2
    priority: 100

  placement-research-debian:
    profile: placement-research
    target: debian
    harness: acp
    max_jobs: 1
    priority: 100
    permissions:
      mutating_actions: false

  coder-fast-debian:
    profile: coder-fast
    target: debian
    harness: acp
    max_jobs: 1
    priority: 100

  coder-dgx:
    profile: coder-deep
    target: dgx
    harness: ssh
    max_jobs: 1
    priority: 100

  spark-hf:
    profile: coder-fast
    target: hf
    harness: openai-compatible
    endpoint_env: "SPYNEL_SPARK_BASE_URL"
    api_key_env: "SPYNEL_SPARK_API_KEY"
    model: "spark-x2.5-1.7b"
    max_jobs: 1
    priority: 80
```

The implementation must validate duplicate IDs, invalid references, unknown profiles/targets/workspaces, impossible workers, bad limits, invalid routing thresholds, and malformed endpoint paths.

---

## 10. Laya System-1 integration

### 10.1 Default hosted service

Use the existing Hugging Face Space as the default remote Laya backend:

```text
Space:
https://huggingface.co/spaces/Leon4gr45/needle-router

Base URL:
https://leon4gr45-needle-router.hf.space

Expected endpoints:
GET  /health
GET  /ready
GET  /v1/info
POST /v1/system-one
```

The coding agent must probe the live contract before hard-coding a request body. If the live request/response schema differs from assumptions, adapt the client to the actual endpoint and add fixture tests for that contract.

The endpoint must remain configurable in YAML/environment.

Do not vendor or install the Laya model locally in this first implementation.

### 10.2 Candidate filtering

Never send the entire worker fleet to Laya.

Before Laya:

1. eliminate profiles forbidden by execution policy;
2. eliminate internal-only profiles;
3. apply deterministic capabilities/rules;
4. use current workspace/session context;
5. keep at most `routing.max_laya_candidates`, default 5.

The request should be small and contain:

- normalized user message;
- channel class;
- current profile/workspace if relevant;
- whether a session is active;
- simple extracted signals (`has_url`, `has_repo`, `has_image`, etc.);
- candidate profile IDs, descriptions, and capabilities.

Laya returns:

- selected profile;
- confidence if supported;
- compact reason code if supported.

If confidence is not native to the endpoint, add a client-side normalized confidence only if the live API exposes enough information. Do not fabricate probability values.

### 10.3 Fail-open behavior

If Laya times out, errors, returns an unknown profile, returns invalid JSON, or returns a disallowed candidate:

- log a bounded diagnostic;
- do not retry indefinitely;
- choose configured fallback/default profile;
- do not expose internal routing errors to the user unless routing cannot proceed.

---

## 11. Workspace resolution

Resolve workspace after profile selection.

Order:

```text
1. explicit #workspace:<id>
2. session-bound workspace
3. conversation-bound workspace
4. current repository/worktree
5. recognized GitHub repository/URL
6. Spynel task/goal metadata
7. deterministic registry match
8. placement researcher
9. configured default or actionable failure
```

Workspace selection must be separate from profile selection.

---

## 12. Placement resolver

After profile + workspace are known, select target and worker.

Eligibility requires:

- worker profile matches selected profile, or declared compatibility;
- target satisfies execution policy;
- workspace is reachable on target or worker can operate remotely on it;
- worker is healthy enough for dispatch;
- worker has capacity;
- required capabilities are present.

Ranking should prefer, in order unless configuration overrides:

1. existing active session/worker;
2. exact explicit target;
3. workspace-local target;
4. healthy local target;
5. healthy remote/DGX target;
6. hosted target;
7. configured worker priority.

Do not send CPU/RAM/GPU health facts to Laya for semantic profile selection.

---

## 13. Placement researcher

Create an internal profile and worker for placement research, initially on Debian.

Its job is only to gather evidence such as:

- which target contains the repo/workspace;
- whether a live service is running on Debian/DGX/hosted;
- SSH reachability;
- HTTP health;
- required runtime from project configuration;
- whether GPU/CUDA is needed;
- approximate CPU/RAM/GPU needs based on known command/runtime;
- current target availability;
- relevant deployment metadata.

It must return structured evidence, for example:

```json
{
  "workspace": "mentor-runtime",
  "recommended_target": "dgx",
  "required_capabilities": ["gpu", "cuda", "live-vllm-logs"],
  "evidence": [
    "workspace has a registered DGX location",
    "task requires reproducing a GPU inference failure",
    "DGX SSH health probe succeeded"
  ],
  "confidence": 0.93
}
```

The placement researcher should be read-only by default.

Initial permissions:

```text
allow:
- repository metadata reads
- local filesystem reads inside configured roots
- Git/GitHub read operations
- HTTP GET/HEAD health probes
- bounded SSH read-only probes from an allowlist
- resource telemetry reads

deny:
- file mutation
- git push
- deployment
- restart
- package installation
- process kill
- destructive shell commands
```

Spynel, not the researcher, makes the final placement decision.

---

## 14. Harness and transport support

Keep the existing harness abstraction.

Add only what is needed to make worker placement practical.

Initial transports:

1. **native/local**  
   Existing local harness execution.

2. **SSH worker**  
   Used for DGX or other remote machines.
   - no shell interpolation;
   - strict command building;
   - configurable host/user/key through env refs;
   - connection timeout;
   - clean cancellation;
   - bounded stdout/stderr;
   - optional remote working directory.

3. **HTTP/OpenAI-compatible worker**  
   Used for hosted agents where appropriate.
   - base URL from env/config;
   - token from env;
   - model per worker;
   - timeout/cancellation;
   - streaming if supported;
   - health check.

Do not force every worker into OpenAI compatibility if an ACP or native adapter is already a better fit.

---

## 15. Completion and achievement reporting

### 15.1 Goal

When a worker finishes, Spynel must not simply dump raw terminal output.

Normalize the result into a concise completion report.

Preferred structured shape:

```go
type CompletionReport struct {
    SessionID    string
    Status       string
    ProfileID    string
    WorkerID     string
    WorkspaceID  string
    TargetID     string

    Summary      string
    Achievements []string
    Verification []string
    Changed      []string
    Blockers     []string
    FollowUps    []string
}
```

### 15.2 How to obtain it

Preferred order:

1. ask compatible workers to end with a small structured completion block;
2. parse the structured block;
3. if unavailable, use a configured lightweight reporting/summarizer profile to normalize the final bounded output;
4. if the summarizer is unavailable, produce a deterministic fallback from final text/status/test metadata.

Never claim tests passed unless the worker output or execution evidence says so.

### 15.3 Human message

Send a compact result message such as:

```text
✓ journeytest-core · coder-fast · spark-hf

Implemented:
- fixed cross-origin handoff handling
- added regression coverage
- updated routing documentation

Verified:
- go test ./... passed
- 3 live journey cases passed

Status: complete
Session: JT-42
```

For failures/blockers, state them plainly.

---

## 16. AGTX integration

AGTX is a status/coordination sink, not the source of truth for Spynel routing.

Use the self-hosted AGTX MCP server instead of scraping AGTX's UI/database.

AGTX currently exposes a project/global MCP server with task operations including project discovery, task creation, task inspection, task movement/status transitions, notifications, and task messaging.

Support two configurations:

```yaml
integrations:
  agtx:
    enabled: true
    mode: "mcp-stdio"
    command: "agtx"
    args: ["mcp-serve"]
    project_mapping:
      spynel: "AUTO"
      journeytest-core: "AUTO"
      mentor-runtime: "AUTO"
    sync_events:
      - dispatched
      - running
      - blocked
      - review
      - completed
      - failed
```

and later, optionally, an HTTP-compatible adapter if AGTX exposes a suitable authenticated remote API.

### 16.1 Mapping behavior

On first dispatch:

1. resolve AGTX project from workspace;
2. create or link one AGTX task;
3. persist mapping:

```text
spynel_session_id -> agtx_project_id + agtx_task_id
```

Initial AGTX description should include:

- original task summary;
- selected profile;
- selected workspace;
- target;
- worker;
- routing source;
- Spynel session ID.

Lifecycle mapping should use AGTX-supported task actions rather than direct DB writes.

Conceptual mapping:

```text
Spynel dispatched -> AGTX task created/planning
Spynel running    -> AGTX running
Spynel blocked    -> AGTX escalation/block status where supported
Spynel review     -> AGTX review
Spynel complete   -> AGTX done
Spynel failed     -> preserve evidence and surface failure without falsely marking done
```

Respect AGTX `allowed_actions` and queue semantics. Do not force illegal phase transitions.

### 16.2 AGTX failure behavior

If AGTX is offline:

- never fail the worker task because of AGTX;
- record a bounded unsynced status event locally;
- retry on later lifecycle changes or via a bounded retry queue;
- expose sync degradation in `/status`;
- avoid an infinite retry loop.

### 16.3 Completion summary

The completion report must always be sent to the active user channel.

AGTX must at minimum receive the final task status. If AGTX exposes a safe supported way to attach a final summary, use it; otherwise keep the detailed achievement summary in Spynel/channel history and store only status/routing metadata in AGTX.

---

## 17. Communication mode A: WhatsApp consolidated mode

Configuration:

```yaml
communication:
  mode: "whatsapp"

channels:
  whatsapp:
    enabled: true
```

Behavior:

- if WhatsApp is connected and selected as communication mode, use it for all new user requests, progress notifications, blockers, and completion reports;
- keep one primary WhatsApp conversation;
- do not spawn separate WhatsApp groups/chats per agent;
- use compact session labels when needed;
- reply/context affinity should map follow-ups to the correct Spynel session;
- explicit `@profile`, `@worker`, `#target`, or `/session` commands may switch sessions.

Example:

```text
[JT-42 · coder-fast/spark-hf] Running tests…
```

then:

```text
[JT-42] ✓ Complete
- fixed navigation origin handling
- tests passed
```

---

## 18. Communication mode B: Telegram private session topics

### 18.1 Preferred deployment: threaded private bot chat

Current Telegram supports topics in private chats with bots when threaded/topic mode is enabled for the bot. Use this as the preferred implementation of "one input chat, then a new chat/thread per agent session."

Preferred requirements:

- enable the bot's threaded/topic mode through Telegram's bot configuration;
- the bot detects that topics are enabled for the private user chat;
- the General/topic-less inbox is the control/inbox surface for new tasks;
- Spynel calls Telegram `createForumTopic` for each new dispatched session;
- subsequent messages use the returned `message_thread_id`.

A forum-enabled supergroup with `can_manage_topics` remains a supported alternative for deployments that prefer a shared/group control room.

Configuration:

```yaml
communication:
  mode: "telegram-topics"

channels:
  telegram:
    enabled: true
    session_topics:
      enabled: true
      deployment: "private"   # private | supergroup
      forum_chat_id_env: ""   # required only for supergroup deployment
      inbox_thread_id_env: "" # optional; empty means General/topic-less inbox
      topic_prefix: "Spy"
      require_topics: false
```

### 18.2 Inbox behavior

In private deployment the user's ordinary bot chat / General thread acts as the inbox for new unbound work.

Example:

```text
#auto investigate why journeytest stops after cross-origin navigation
```

Spynel routes it and creates a new private bot topic:

```text
Spy · journeytest · coder-fast · 42
```

The first message in that topic should summarize:

- original request;
- profile;
- workspace;
- target/worker;
- routing source.

The agent's progress and final answer go to that topic.

For supergroup deployment, the configured inbox topic serves the same role.

### 18.3 Session continuation

Messages sent inside an agent topic automatically bind to that Spynel session through `message_thread_id`.

Example:

```text
run the live test again
```

must continue the same session unless the user explicitly overrides with routing tags.

This gives independent long-lived conversations per agent session while retaining one Telegram bot entry point.

### 18.4 Completion

When the worker returns:

1. produce completion report;
2. post it to the agent topic;
3. update AGTX status;
4. optionally post a one-line completion marker in the General/inbox thread if configured.

Do not duplicate full completion reports into the inbox by default.

### 18.5 Fallback

If private bot topics are not enabled, or topic creation is unavailable, and `require_topics=false`:

- optionally use a configured forum-enabled supergroup; otherwise
- use the same Telegram chat;
- prefix messages with the Spynel session ID;
- maintain reply-to/session affinity.

If `require_topics=true`, fail configuration validation with an actionable explanation describing how to enable Telegram bot threaded/topics mode or configure a forum supergroup.

---

## 19. Channel selection

Only one primary communication mode should be active at a time:

```yaml
communication:
  mode: "whatsapp"
```

or:

```yaml
communication:
  mode: "telegram-topics"
```

TUI/CLI remain administrative/local surfaces regardless of primary remote mode.

Provide a command/settings surface to inspect/switch mode without editing YAML manually if it fits current Spynel configuration patterns.

Suggested commands:

```text
/channel
/channel whatsapp
/channel telegram
```

Do not silently mirror all messages to both remote channels.

---

## 20. Status and inspection commands

Extend status surfaces without leaking secrets.

Suggested:

```text
/agents
/routes
/route auto
/route <profile>
/sessions
/session new
/session <id>
/placement
```

`/agents` should show:

- profile;
- workers;
- target;
- readiness;
- capacity/busy state.

`/status` may show the current conversation/session routing:

```text
Session      JT-42
Profile      coder-fast
Workspace    journeytest-core
Target       hf
Worker       spark-hf
Route        laya
AGTX         synced
Channel      telegram topic 123
```

Do not expose tokens, SSH keys, raw environment values, or full prompts.

---

## 21. Persistence

Persist durable mappings under `.spynel/` using the repository's existing persistence conventions.

Required durable mappings:

```text
session -> profile/workspace/target/worker
session -> harness thread ID
session -> Telegram forum topic
session -> AGTX project/task
conversation/topic -> current session
```

Use atomic writes/SQLite according to existing Spynel patterns. Prefer extending an existing durable store if one already fits rather than creating many unrelated files.

---

## 22. Security

### 22.1 Configuration

- secrets via environment references;
- never serialize token values into logs/status/history;
- validate URLs;
- bound all routing strings;
- reject malformed profile/worker IDs;
- no shell interpolation.

### 22.2 SSH

- explicit allowlisted target definitions;
- bounded timeouts;
- no arbitrary host supplied directly from a user message;
- optional known-host verification setting;
- placement researcher may execute only an allowlisted read-only probe set.

### 22.3 Laya

Treat Laya output as untrusted data.

Validate:

- selected profile is in supplied candidates;
- IDs and reason codes are bounded;
- output schema;
- no returned text becomes a shell command.

### 22.4 Telegram and WhatsApp

Retain existing sender allowlists/authentication.

Telegram topic IDs are routing metadata, not authorization.

---

## 23. Backward compatibility

If `.spynel/agents.yaml` does not exist or `routing.enabled=false`:

- current Spynel harness selection works exactly as before;
- existing channel behavior works;
- existing config keys remain valid;
- no Laya/AGTX dependency is required.

Migration should be additive.

Where current role prefixes exist (`chat`, `developer`, `reviewer`, `heartbeat`), keep support and allow profiles to incorporate them.

---

## 24. Tests

Add comprehensive tests.

### 24.1 Parser

- `#local`, `#hosted`, concrete targets;
- `#workspace:<id>`;
- profile mentions;
- concrete worker mentions;
- email addresses not treated as routing;
- unknown tags preserved or rejected according to policy;
- routing metadata removed from worker text.

### 24.2 Precedence

Test exact ordering:

- explicit worker beats Laya;
- explicit profile beats affinity;
- active session beats Laya;
- workflow role beats Laya;
- deterministic capability rule beats Laya;
- Laya used only when needed;
- default profile on Laya failure.

### 24.3 Laya

Fixture server tests for:

- healthy result;
- timeout;
- 500;
- invalid JSON;
- unknown profile;
- disallowed candidate;
- contract mismatch;
- bounded candidate list;
- cancellation.

If network is available during development, add a non-default live smoke test script that probes the configured Hugging Face Space without making the normal unit suite depend on the Internet.

### 24.4 Placement

- explicit DGX target;
- local-only policy excludes HF;
- hosted policy excludes Debian/DGX if defined local;
- workspace locality preference;
- busy worker fallback;
- unhealthy worker fallback;
- placement researcher invoked only when required;
- placement researcher cannot mutate.

### 24.5 Affinity

- follow-up returns to same worker;
- explicit override creates/rebinds route;
- TTL expiry;
- Telegram topic binding;
- WhatsApp reply/session binding.

### 24.6 AGTX

Mock MCP process:

- project resolution;
- task creation;
- legal phase transitions;
- `allowed_actions` honored;
- AGTX offline does not fail worker;
- retry queue bounded;
- session/task mapping persisted.

### 24.7 Telegram

Mock Bot API:

- create forum topic on new session;
- topic mapping persisted;
- follow-up inside topic binds session;
- completion posted to correct topic;
- fallback when topic creation fails;
- require-topics configuration failure.

### 24.8 WhatsApp

- one consolidated conversation;
- session label;
- follow-up binding;
- no Telegram duplication when WhatsApp is primary.

### 24.9 Reporting

- structured completion parsing;
- fallback summary;
- no fabricated test success;
- blockers preserved;
- AGTX status and channel completion emitted exactly once.

### 24.10 Regression

Run:

```bash
go test ./...
```

and any repository-specific lint/build checks documented in `AGENTS.md` and project documentation.

---

## 25. Observability

Add structured, bounded routing events.

Examples:

```text
route.decision
placement.decision
worker.dispatch
worker.complete
worker.failed
laya.error
placement.research
agtx.sync
telegram.topic.create
```

Fields may include IDs and reason codes, never secrets or full sensitive prompts.

Useful routing metrics:

- explicit vs affinity vs deterministic vs Laya decisions;
- Laya latency;
- placement-research rate;
- worker utilization;
- routing fallback count;
- AGTX sync errors;
- session completion count.

---

## 26. Implementation phases

### Phase 1 — Registry + deterministic router

- `.spynel/agents.yaml`
- profiles/targets/workspaces/workers
- parser for `#` and `@`
- routing precedence
- session affinity
- deterministic placement
- compatibility fallback

### Phase 2 — Laya client

- live contract probe
- candidate filtering
- System-1 request/response
- timeout/fallback
- tests

### Phase 3 — multi-target dispatch

- local worker registry
- SSH worker adapter
- HTTP/OpenAI-compatible adapter as needed
- capacity/health

### Phase 4 — placement researcher

- Debian read-only worker
- structured evidence
- restricted probes
- placement integration

### Phase 5 — completion reporting + AGTX

- completion report contract
- fallback summarizer
- AGTX MCP sink
- durable mappings
- status lifecycle sync

### Phase 6 — remote channel modes

- WhatsApp consolidated mode
- Telegram private/topic inbox
- one topic per session
- topic/session persistence
- topic fallback

### Phase 7 — UI/status hardening

- `/agents`
- `/routes`
- `/sessions`
- `/placement`
- config forms where appropriate
- docs

---

## 27. First vertical-slice acceptance criteria

The initial implementation is successful when all of the following are true:

1. Existing Spynel still runs without `.spynel/agents.yaml`.
2. With routing enabled, a message such as:

   ```text
   #dgx @coder debug the inference crash
   ```

   bypasses Laya, resolves a coding profile, constrains placement to DGX, and selects an eligible DGX worker.

3. An untagged ambiguous message invokes the Laya HF endpoint after deterministic candidate filtering and selects only from allowed profiles.

4. A follow-up message without tags stays on the same Spynel session/worker.

5. A task with unknown compute/location requirements can invoke the Debian placement researcher and then dispatch to the selected target.

6. A completion event produces a concise achievement report.

7. Completion/progress lifecycle is reflected into AGTX through the MCP adapter without breaking the task if AGTX is offline.

8. In WhatsApp mode the result returns to the consolidated WhatsApp conversation.

9. In Telegram forum mode a new session creates a new topic and all subsequent messages in that topic continue that session.

10. `go test ./...` passes.

---

## 28. Live Laya verification

At implementation time, explicitly verify:

```text
https://huggingface.co/spaces/Leon4gr45/needle-router
```

and the runtime base URL:

```text
https://leon4gr45-needle-router.hf.space
```

Probe:

```text
/health
/ready
/v1/info
/v1/system-one
```

Do not assume the POST schema. Inspect the live service contract and implement against observed behavior.

The HF Space is the default backend, but all URLs remain configurable.

---

## 29. AGTX verification

Reference implementation:

```text
https://github.com/fynnfluegge/agtx
```

Prefer:

```bash
agtx mcp-serve
```

or project-scoped:

```bash
agtx mcp-serve <path>
```

Use supported MCP operations such as project discovery, task creation, task inspection, valid task movement, and notifications/status inspection.

Do not write directly into AGTX SQLite.

Respect the fact that some AGTX transitions are queued and require a running AGTX/TUI/orchestrator process to take effect.

---

## 30. Definition of done

A change is done only when:

- code is formatted;
- unit/integration tests pass;
- old config remains supported;
- no credentials are committed;
- Laya failure is safe;
- AGTX failure is safe;
- channel routing is deterministic;
- Telegram topic behavior is documented;
- security boundaries are tested;
- README/docs include setup examples;
- `.spynel/agents.example.yaml` is provided;
- routing decisions are inspectable without exposing secrets;
- a concise implementation report lists changed files, tests, known limitations, and next steps.
