# TrueForge + Headroom + Needle-3 Integration Specification

**Repository:** `JsonLord/trueforge`  
**Status:** Implementation specification  
**Date:** 2026-09-24  
**Primary target:** `packages/trueforge-core`  
**Implementation priority:** P0 first; P1 only after P0 is complete and verified.

---

## 1. Purpose

Extend TrueForge with two optional, composable capabilities:

1. **Headroom** for ephemeral, per-request context optimization immediately before the main LLM call.
2. **Needle-3** as a lightweight control-plane model for tool retrieval, tool candidate selection, structured extraction, embeddings, and confidence-assisted routing.

TrueForge must remain the authoritative agent runtime. The integration must reuse TrueForge's existing capability, context-processing, MCP, deferred-tool, approval, session, and compaction mechanisms rather than introducing a second agent loop or parallel orchestration framework.

The design must be:

- opt-in,
- fail-open,
- backwards-compatible,
- observable,
- independently disableable,
- testable without live external services,
- safe with existing approval and tool-execution policies.

---

## 2. Architectural principles

### 2.1 TrueForge remains the control plane

TrueForge continues to own:

- the agent loop,
- session state,
- model invocation,
- tool lifecycle,
- MCP integration,
- deferred tools,
- approvals,
- sandbox/security boundaries,
- durable context compaction,
- capability registration,
- retries and runtime error handling.

Neither Headroom nor Needle-3 may become an independent orchestration layer.

### 2.2 Headroom is an ephemeral context layer

Headroom should optimize the context used for an individual LLM request without rewriting the canonical TrueForge conversation/session history.

Use the existing **ephemeral pre-LLM context processing seam** wherever possible.

Conceptually:

```text
canonical session state
        |
        v
TrueForge context assembly
        |
        v
preLLMEphemeral processors
        |
        +---- Headroom optimization
        |
        v
main LLM request
```

The optimized request is disposable. The durable session remains owned by TrueForge.

### 2.3 Needle-3 is a micro-model control layer

Needle-3 is not a replacement for the primary reasoning model.

Its initial responsibilities are:

- tool retrieval,
- tool candidate ranking,
- structured tool-selection assistance,
- embeddings,
- confidence signals,
- optional lightweight classification.

P0 must **not** allow Needle-3 to bypass the TrueForge agent loop, approval system, or tool security policy.

### 2.4 Durable compaction and request compression are separate

Do not let TrueForge durable compaction and Headroom repeatedly summarize/compress the same data without defined ownership.

Responsibility split:

| Component | Responsibility |
|---|---|
| TrueForge session/context storage | canonical conversation state |
| TrueForge durable compaction | long-running session reduction/checkpointing |
| TrueForge large-result/artifact handling | oversized durable artifacts/results |
| Headroom | ephemeral optimization of an individual model request |
| Needle-3 | cheap tool retrieval/selection/extraction/embedding |
| Main LLM | planning, reasoning, synthesis, complex tool decisions |

---

## 3. Existing TrueForge extension points to reuse

Before modifying code, inspect the current implementations and tests around:

- `packages/trueforge-core/src/core/capabilities/AgentCapability.ts`
- `packages/trueforge-core/src/core/capabilities/AgentContextProcessor.ts`
- `packages/trueforge-core/src/core/capabilities/builtins/ContextCompaction.ts`
- `packages/trueforge-core/src/core/mcp/ToolSelectorPolicy.ts`
- `packages/trueforge-core/src/core/runtime/DeferredTool.ts`
- `packages/trueforge-core/src/core/runtime/AgentThread.ts`

Also read:

- repository root `AGENTS.md`
- every nested `AGENTS.md` that applies to changed files

The current repo already has an important distinction between:

- durable `preLLM` context processors, and
- non-persisted `preLLMEphemeral` context processors.

Headroom should preferentially use `preLLMEphemeral`.

The current repo also already has:

- a tool-selection policy abstraction, and
- deferred tool machinery.

Needle-3 should preferentially integrate through those abstractions.

Do **not** invent new top-level `ContextTransform`, `AgentRouter`, or tool lifecycle frameworks unless inspection proves that an existing seam cannot support the requirement cleanly.

---

## 4. Target architecture

```text
                         TRUEFORGE
                 ┌─────────────────────┐
Request ────────►│ Agent Runtime       │
                 │ Session / Policies  │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Tool Candidate Stage│
                 │                     │
                 │ Needle-3 adapter    │
                 │ embeddings/ranking  │
                 │ confidence          │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Existing Deferred   │
                 │ Tool machinery      │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Context assembly    │
                 │ canonical state     │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ preLLMEphemeral     │
                 │                     │
                 │ Headroom processor  │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Main reasoning LLM  │
                 └──────────┬──────────┘
                            │
                       tool requests
                            │
                            ▼
                 ┌─────────────────────┐
                 │ TrueForge approvals │
                 │ + tool execution    │
                 └──────────┬──────────┘
                            │
                            └──────► existing loop
```

---

# Part A — Headroom integration

## 5. Headroom goals

Add Headroom as an optional context optimization capability that:

- operates immediately before an LLM request,
- does not persist its modified context into canonical session history,
- preserves tool-call/tool-result integrity,
- preserves protected instructions,
- fails open to the unmodified context,
- emits useful compression telemetry,
- does not replace TrueForge durable compaction.

Preferred implementation:

```text
AgentCapability
  └─ contextProcessors
      └─ preLLMEphemeral
          └─ HeadroomContextProcessor
```

If the current capability API already supports this without a core contract change, use it directly.

---

## 6. Headroom execution modes

Support an adapter boundary rather than coupling runtime code directly to one transport.

Recommended conceptual interface:

```ts
export interface HeadroomClient {
  optimize(input: HeadroomOptimizeInput): Promise<HeadroomOptimizeResult>;
}
```

Potential implementations:

1. **In-process**
   - uses the TypeScript `headroom-ai` package,
   - preferred when dependency/runtime compatibility is clean.

2. **HTTP/compression service**
   - calls a configured Headroom compression endpoint,
   - useful when Headroom is deployed as a sidecar/service.

3. **Proxy mode**
   - may be documented as a zero/minimal-code deployment option,
   - should not be the only supported architecture if an explicit context processor integrates cleanly.

Do not make TrueForge depend on a particular Headroom deployment topology.

---

## 7. Headroom context processor

Add a Headroom-specific ephemeral processor/capability using the existing TrueForge types.

Names are illustrative; align exact names and file placement with current repository conventions after inspection.

Possible shape:

```ts
type HeadroomMode = "cache" | "token";

interface HeadroomOptions {
  enabled?: boolean;
  mode?: HeadroomMode;
  minInputTokens?: number;
  protectRecentTurns?: number;
  failOpen?: boolean;
  timeoutMs?: number;
}

class HeadroomContextProcessor {
  // implement the existing preLLMEphemeral processor contract
}
```

### Required behavior

The processor must:

1. receive an already-assembled TrueForge model context;
2. determine whether compression should run;
3. clone/transform only the ephemeral request representation;
4. send eligible messages/content to Headroom;
5. reconstruct a valid TrueForge model context;
6. preserve all required IDs/relationships;
7. return the optimized context;
8. return the original context unchanged if optimization is skipped or fails.

### Protected content

The implementation must explicitly determine and test how to protect:

- system/runtime instructions,
- security/policy instructions,
- unresolved tool calls,
- tool-call IDs,
- matching tool-result IDs,
- tool-call/result ordering,
- structured content needed by the model provider,
- the most recent turns,
- any TrueForge-internal markers required by compaction or deferred-tool behavior.

Do not silently convert structured tool messages into lossy plain text.

### Default mode

Prefer a **cache-preserving** Headroom mode as the default if supported by the installed Headroom version.

The objective is to reduce redundant context while avoiding unnecessary invalidation of provider prefix caches.

---

## 8. Async compatibility requirement

Before changing any interface, verify:

1. whether the current `preLLMEphemeral` processor contract is synchronous;
2. whether the selected Headroom integration is synchronous or asynchronous.

If Headroom requires async processing and TrueForge currently assumes synchronous ephemeral processors:

- make the smallest backwards-compatible extension possible;
- allow processors to return either a value or `Promise<value>`;
- `await` the processor chain in the existing request path;
- keep all existing synchronous processors valid without modifications.

Conceptually:

```ts
type MaybePromise<T> = T | Promise<T>;
```

Do not create a parallel asynchronous context pipeline merely for Headroom.

Add regression tests for processor order and current synchronous implementations.

---

## 9. Headroom and TrueForge compaction interaction

TrueForge's durable `ContextCompaction` remains authoritative for persisted/session-level compaction.

Headroom must **not** write its optimized representation back into canonical history.

Desired behavior:

```text
Session messages
    |
    +--> TrueForge durable compaction, when normal threshold requires it
    |
    +--> request clone
             |
             +--> Headroom ephemeral optimization
                     |
                     +--> LLM only
```

Avoid:

```text
session
 -> TrueForge compacts
 -> Headroom rewrites
 -> Headroom output persisted
 -> TrueForge compacts rewritten Headroom output again
```

Add a test proving that a Headroom-optimized LLM call does not mutate the stored session transcript.

---

## 10. Headroom configuration

Use the existing TrueForge configuration pattern. Do not introduce a separate config subsystem.

Illustrative configuration only:

```yaml
headroom:
  enabled: false
  transport: in_process
  mode: cache

  min_input_tokens: 4000
  protect_recent_turns: 4

  timeout_ms: 3000
  fail_open: true
```

For service mode:

```yaml
headroom:
  enabled: true
  transport: http
  endpoint: ${HEADROOM_URL}
  api_key_env: HEADROOM_API_KEY
  fail_open: true
```

Exact field names should match existing TrueForge naming conventions.

### Defaults

- disabled unless explicitly enabled;
- fail-open enabled;
- no secrets committed;
- environment-variable references for credentials;
- conservative threshold so tiny prompts are not compressed unnecessarily.

---

# Part B — Needle-3 integration

## 11. Needle-3 goals

Add Needle-3 as an optional lightweight model integration for:

- embedding tools,
- ranking relevant tool candidates,
- constrained tool selection,
- structured extraction,
- confidence reporting.

For P0, Needle-3 must **not**:

- act as the primary chat/reasoning model,
- own the agent loop,
- execute tools directly,
- bypass TrueForge approvals,
- mutate session history,
- replace deferred-tool handling,
- replace MCP discovery/registration.

---

## 12. Needle client boundary

Create a small adapter boundary around the Needle runtime/API.

Illustrative API:

```ts
export interface NeedleClient {
  embed(input: string | string[]): Promise<number[][]>;

  selectTool?(input: NeedleToolSelectionInput):
    Promise<NeedleToolSelectionResult>;

  extract?<T>(
    input: NeedleExtractionInput<T>
  ): Promise<NeedleExtractionResult<T>>;
}
```

Do not leak Needle-specific HTTP or SDK response objects through TrueForge core abstractions.

The adapter should normalize:

- embeddings,
- selected tool IDs,
- extracted arguments,
- confidence,
- errors/timeouts.

The transport can later be swapped without changing the TrueForge tool policy.

---

## 13. Needle tool-selection policy

Prefer implementing Needle through the existing `ToolSelectorPolicy` seam.

Conceptually:

```text
Tool registry
    |
    v
normalize tool metadata/schema
    |
    v
Needle embeddings
    |
    v
cached tool index
    |
user request embedding
    |
    v
top-K candidate tools
    |
    v
optional Needle constrained selection
    |
    v
existing TrueForge deferred-tool path
```

Possible implementation name:

```text
NeedleToolSelectorPolicy
```

but follow existing naming conventions.

### P0 behavior

P0 should use Needle to **reduce the candidate tool set** exposed to subsequent TrueForge processing.

It should not automatically execute the selected tool.

The main agent loop and approval system remain authoritative.

### Retrieval input

At minimum, tool embeddings should represent useful normalized information such as:

- tool name,
- description,
- input schema,
- MCP/server namespace where relevant.

Avoid embedding unstable runtime metadata that causes unnecessary cache invalidation.

### Cache

Cache tool embeddings/index entries keyed by a deterministic identity such as:

```text
hash(
  tool name
  + normalized description
  + normalized input schema
  + namespace/provider identity
)
```

When tool definitions change, corresponding embeddings must be invalidated.

Do not assume the tool registry is immutable for the life of the process.

---

## 14. Needle confidence

Needle confidence is an input to routing policy, not an authorization mechanism.

Invariant:

```text
Needle confidence != permission to execute
```

Suggested configurable concepts:

```yaml
needle:
  confidence:
    high: 0.90
    fallback_below: 0.65
```

These numbers are placeholders, not required hard-coded defaults.

P0 should use confidence conservatively:

- high confidence can strengthen candidate ranking;
- low confidence should fall back to existing TrueForge behavior;
- ambiguity should widen the candidate set or bypass Needle selection.

Never drop all tools merely because Needle is uncertain.

---

## 15. Needle fail-open behavior

If Needle is:

- disabled,
- unreachable,
- timed out,
- returns malformed output,
- returns an invalid tool ID,
- produces low confidence,
- cannot embed the current tool registry,

TrueForge must fall back to its existing/default tool-selection behavior.

The agent must remain usable when Needle is absent.

---

## 16. Needle configuration

Use existing TrueForge configuration conventions.

Illustrative only:

```yaml
needle:
  enabled: false

  endpoint: ${NEEDLE_URL}
  model: needle-3

  tool_selection:
    enabled: true
    top_k: 8

  embeddings:
    enabled: true
    cache: true

  timeout_ms: 2000
  fail_open: true
```

Potential future fields:

```yaml
needle:
  extraction:
    enabled: false

  routing:
    enabled: false
```

P0 should not enable experimental fast-path routing by default.

---

# Part C — Combined request flow

## 17. P0 request lifecycle

The intended P0 lifecycle is:

```text
1. User request enters TrueForge
2. TrueForge loads canonical session/runtime state
3. Tool registry/deferred tools are available
4. NeedleToolSelectorPolicy optionally narrows relevant tool candidates
5. Existing TrueForge tool/deferred-tool machinery prepares model-visible tools
6. TrueForge assembles model context
7. Existing durable processing occurs according to current semantics
8. Headroom preLLMEphemeral processor optionally optimizes request context
9. Main reasoning model receives optimized context + selected tools
10. Main model requests tool calls
11. TrueForge performs existing approval/policy checks
12. TrueForge executes permitted tools through existing machinery
13. Tool results return through the existing agent loop
14. Canonical session persists according to existing TrueForge behavior
```

Headroom output itself is not persisted.

Needle selection itself does not grant permission.

---

# Part D — Optional P1 features

## 18. P1: Needle structured argument extraction

After P0 is stable, Needle may optionally pre-fill or validate structured arguments for candidate tools.

Rules:

- extracted arguments are proposals, not trusted input;
- validate against the canonical TrueForge/tool JSON schema;
- normal approval semantics remain;
- malformed or low-confidence extraction falls back to the main model/current path.

This feature should be separately configurable.

---

## 19. P1: request classification / fast path

A later feature may allow Needle to classify very simple requests such as:

```text
"show git status"
"read package.json"
"list current branches"
```

Potential route:

```text
request
 -> Needle classifier
 -> safe/read-only candidate action
 -> existing TrueForge policy + approval engine
 -> tool
```

This must remain **disabled by default** until TrueForge has an explicit and tested way to classify which tools/actions are eligible for direct execution.

Do not infer safety from the tool name alone.

A destructive or state-changing action must never become executable merely because Needle returns high confidence.

---

# Part E — Observability

## 20. Metrics

Add integration-level metrics using existing TrueForge telemetry conventions if available.

### Headroom

Useful measurements:

- enabled/bypassed,
- input token estimate,
- output token estimate,
- absolute tokens saved,
- percent saved,
- compression mode,
- optimization latency,
- timeout count,
- failure/fail-open count.

### Needle

Useful measurements:

- tool count before retrieval,
- tool count after retrieval,
- selected candidate IDs,
- confidence,
- embedding cache hit/miss,
- selection latency,
- timeout count,
- fail-open count.

### Privacy

Do not log raw user prompts, raw tool results, credentials, secrets, or full compressed context by default.

Diagnostics should favor metadata and IDs.

---

# Part F — Testing

## 21. Test requirements

Tests must live in the appropriate package-level test locations according to repository conventions and applicable `AGENTS.md` instructions.

Use mocks/fakes for Headroom and Needle. Normal test runs must not require external services.

### 21.1 Headroom unit tests

Cover:

- disabled integration returns original context;
- below-threshold request bypasses compression;
- successful optimization returns transformed ephemeral context;
- canonical session/context remains unchanged;
- protected recent turns remain intact;
- system/runtime instructions remain intact;
- tool-call IDs remain intact;
- tool-result IDs still match their tool calls;
- ordering remains valid;
- timeout returns original context;
- adapter error returns original context when `failOpen=true`;
- processor order remains deterministic;
- existing synchronous processors still work if async support is added.

### 21.2 Headroom integration tests

Create a representative long fixture containing:

- normal messages,
- tool calls,
- large tool output,
- repeated content,
- recent unresolved/relevant information.

Verify that:

- model-bound context becomes smaller when mock Headroom optimization runs;
- durable session history does not receive the optimized form;
- subsequent tool processing still succeeds.

### 21.3 Needle unit tests

Cover:

- disabled integration uses existing selection behavior;
- tool embeddings are cached;
- changed tool schema invalidates cache entry;
- top-K ranking returns only valid registered tools;
- invalid Needle tool IDs are discarded;
- low confidence falls back safely;
- timeout falls back safely;
- malformed response falls back safely;
- zero results do not make all tools inaccessible;
- registry changes are handled.

### 21.4 Needle integration tests

Use a fixture tool registry with intentionally similar and irrelevant tools.

Example request:

```text
"Find the open pull requests for this repository"
```

Verify that:

- GitHub/PR-related tool candidates remain available;
- unrelated tool candidates are reduced;
- the existing deferred-tool mechanism still controls final tool exposure;
- approval behavior is unchanged.

### 21.5 Combined test

Add at least one test where both integrations are enabled:

```text
Needle tool filtering
 -> context assembly
 -> Headroom ephemeral optimization
 -> mock main model call
```

Assert:

- intended tool remains available;
- prompt/context is reduced;
- stored transcript remains canonical;
- neither integration bypasses approval/tool policy.

---

# Part G — Failure and security invariants

## 22. Required invariants

The implementation is not complete unless these hold:

1. **Both features disabled = existing TrueForge behavior.**
2. **Headroom unavailable = request proceeds using original context.**
3. **Needle unavailable = existing/default tool-selection path is used.**
4. **Needle never grants execution permission.**
5. **Headroom never rewrites canonical session history in P0.**
6. **Tool-call/result identity and ordering remain valid after Headroom.**
7. **Existing approval rules apply exactly as before.**
8. **No required network dependency is introduced for users who do not enable the features.**
9. **Secrets are supplied through existing secret/environment configuration mechanisms.**
10. **Generated SDK/client artifacts are not manually edited.**
11. **Published-package changes receive the repository-required changeset.**
12. **Schemas/types have one canonical owner rather than duplicated definitions.**

---

# Part H — Package and dependency strategy

## 23. Dependency placement

Before adding dependencies, inspect workspace/package conventions.

Prefer:

- optional integration dependencies where practical;
- narrow adapter imports;
- no requirement that all TrueForge installations ship a heavy Needle runtime;
- no Headroom runtime initialization when disabled.

If `headroom-ai` is suitable for direct TypeScript integration, determine whether it belongs as:

- a dependency,
- optional dependency,
- peer dependency,
- or separate integration package,

based on existing TrueForge package patterns.

Needle should preferably be accessed through a narrow client/transport adapter so TrueForge core does not depend on a model-specific native runtime.

Do not make package-layout changes solely for architectural aesthetics.

---

# Part I — Implementation phases

## 24. P0 implementation sequence

### P0.0 — Repository mapping

Before edits:

- read root and nested `AGENTS.md`;
- inspect the existing context processor pipeline;
- inspect `AgentThread` model-call flow;
- inspect current `ToolSelectorPolicy`;
- inspect deferred-tool behavior;
- inspect configuration patterns;
- inspect telemetry patterns;
- inspect relevant tests;
- inspect package export patterns.

Produce a short implementation map before coding.

### P0.1 — Headroom adapter + tests

Implement:

- configuration,
- adapter/client abstraction,
- ephemeral processor/capability,
- fail-open behavior,
- unit tests.

If async pipeline support is required, implement the minimal backwards-compatible Promise-or-value change with regression tests.

### P0.2 — Needle adapter + tool selector

Implement:

- configuration,
- Needle client boundary,
- embeddings/ranking,
- tool-index cache,
- `ToolSelectorPolicy` integration,
- confidence/fallback behavior,
- unit tests.

P0 ends at candidate selection. No direct tool execution.

### P0.3 — Combined integration + telemetry

Implement:

- combined test,
- metrics/logging,
- integration docs/examples,
- validation of disabled behavior.

### P0.4 — Repository maintenance

Complete:

- required changeset for published package changes,
- package exports,
- docs,
- repository-prescribed formatting,
- lint,
- typecheck/build,
- relevant tests.

Do not manually edit generated SDK files.

---

## 25. P1 sequence

Only after P0 is merged/stable:

1. Needle structured argument extraction.
2. Optional request classifier.
3. Explicitly safe fast-path execution through existing TrueForge policies.
4. richer Headroom optimization policies.
5. per-model/context-budget adaptive compression.
6. context-ledger/provenance diagnostics if needed.

P1 is not part of the initial implementation unless specifically requested.

---

# Part J — Acceptance criteria

## 26. P0 acceptance criteria

P0 is complete when all of the following are true.

### Architecture

- [ ] TrueForge remains the only agent runtime/orchestrator.
- [ ] Headroom uses the existing ephemeral pre-LLM seam or the smallest compatible extension.
- [ ] Needle uses the existing tool-selection/deferred-tool machinery.
- [ ] No second agent loop is introduced.

### Headroom

- [ ] Feature is disabled by default.
- [ ] Can be enabled through normal TrueForge configuration.
- [ ] Runs only on the model-bound ephemeral context.
- [ ] Does not alter canonical session history.
- [ ] Preserves system instructions and tool message integrity.
- [ ] Fails open.
- [ ] Has deterministic mocked tests.
- [ ] Emits useful metadata/telemetry without logging raw secrets/content by default.

### Needle

- [ ] Feature is disabled by default.
- [ ] Uses a narrow client adapter.
- [ ] Can rank/filter tool candidates.
- [ ] Reuses the existing tool-selection policy/deferred-tool path.
- [ ] Maintains a cacheable tool embedding index.
- [ ] Handles registry/schema changes.
- [ ] Uses confidence only as a routing signal.
- [ ] Fails open to the current selection behavior.
- [ ] Does not execute tools directly in P0.
- [ ] Does not bypass approvals.

### Repository quality

- [ ] Existing behavior still passes when both features are disabled.
- [ ] Appropriate unit and integration tests are added.
- [ ] Repo-prescribed format/lint/typecheck/build/test commands pass.
- [ ] Generated SDKs are not manually edited.
- [ ] A changeset is added when required.
- [ ] Documentation explains configuration, fallbacks, and architecture.

---

# Part K — Design decisions Codex must verify before editing

## 27. Questions to resolve from the actual codebase

Codex should answer these from repository inspection rather than assumptions:

1. Is `preLLMEphemeral` currently synchronous, asynchronous, or already Promise-aware?
2. What exact type does a pre-LLM processor receive and return?
3. At what exact point in `AgentThread` is the ephemeral result passed to the model provider?
4. Does TrueForge clone the context before ephemeral processing, or must the Headroom processor ensure immutability?
5. How does `ToolSelectorPolicy` currently select/expose tools?
6. How does `DeferredTool` interact with tool selection and model-visible schemas?
7. Where should integration configuration live according to current config conventions?
8. Where do package-level exports need to be added?
9. What telemetry abstraction already exists?
10. Should `headroom-ai` be an optional dependency or isolated adapter package?
11. What exact Needle transport is appropriate for the intended deployment?
12. Is there an existing embedding/vector utility that should be reused rather than adding another cache/index abstraction?
13. Which changes require a changeset under current repository rules?
14. Which files are generated and therefore off-limits for manual edits?

If repository facts conflict with this spec, preserve the **architectural invariants** while adapting implementation details to the existing design.

---

# Part L — Expected deliverables

## 28. Initial implementation deliverables

The first implementation should leave the repository with:

1. Headroom configuration schema/types.
2. Headroom client/adapter.
3. Headroom ephemeral context processor/capability.
4. Needle configuration schema/types.
5. Needle client/adapter.
6. Needle-backed `ToolSelectorPolicy` implementation or equivalent reuse of the existing selection seam.
7. Tool embedding/index cache with invalidation.
8. Fail-open behavior for both integrations.
9. Unit tests.
10. At least one combined integration test.
11. Documentation/example configuration.
12. Required package exports.
13. Required changeset.
14. No manual generated-SDK edits.
15. A final implementation report containing:
    - files changed,
    - architectural choices,
    - tests/checks run,
    - exact results,
    - remaining P1 work,
    - any deviations from this spec and why.

---

# Part M — Explicit non-goals for P0

Do not implement the following in the first pass:

- a new general-purpose agent router framework;
- a second conversation/session store;
- a second MCP runtime;
- direct tool execution from Needle;
- autonomous destructive fast paths;
- replacement of TrueForge `ContextCompaction`;
- persistence of Headroom-compressed history;
- a general vector database solely for tool retrieval unless existing scale requires it;
- model-specific logic spread throughout `AgentThread`;
- hard-coded model endpoints or secrets;
- broad refactors unrelated to this integration.

The P0 patch should be the smallest coherent integration that proves the architecture through existing TrueForge extension points.

---

## 29. Guiding implementation rule

When choosing between:

```text
new subsystem
```

and:

```text
small adapter implementing an existing TrueForge abstraction
```

prefer the adapter.

The integration is successful when Headroom and Needle-3 feel like native TrueForge capabilities, not frameworks embedded inside another framework.
