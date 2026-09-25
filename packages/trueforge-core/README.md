# @truefoundry/trueforge-core

## Optional context and tool retrieval adapters

`headroom(...)` installs a non-persistent `preLLMEphemeral` processor. Supply a `HeadroomClient`, explicitly set
`enabled: true`, and pass the returned capability to an agent thread. The adapter protects system, tool, and recent
messages, uses cache-preserving mode by default, and falls back to the original model context on timeout, error, or an
invalid optimized result. It never replaces durable session history or `contextCompaction(...)`.

`needleToolSelection(...)` installs optional semantic retrieval for deferred tool discovery. Supply a `NeedleClient`
that produces embeddings and optionally normalized tool IDs with confidence. The selector caches tool embeddings by
schema fingerprint and falls back to the complete authorized tool list when disabled, unavailable, malformed, empty,
or uncertain. Tool calls still pass through the existing `ToolSet`, approval, and deferred execution paths; the
integration does not execute tools.

Needle argument extraction is separately opt-in with `argumentExtractionEnabled: true`. Valid, sufficiently confident
proposals replace the main model's arguments before the assistant tool call is persisted, then pass through canonical
JSON Schema validation and the existing approval, security, and `ToolSet` execution path. Invalid or unavailable
proposals retain the main model's original arguments.

Needle request classification is separately opt-in with `requestClassificationEnabled: true`. It records a conservative
complexity, action class, and confidence in request-scoped metadata and structured logs. Classification reads only the
latest canonical user request and currently has no effect on models, tools, approvals, routing, or execution.

### Evaluating request classification

The offline `evaluateRequestClassifier(...)` harness calls the same normalized `RequestClassifier` contract used by
the runtime. Complexity is one of `simple`, `reasoning`, or `unknown`; action class is one of `read`, `write`,
`destructive`, `external_side_effect`, or `unknown`. These labels describe a request and never grant runtime authority.

`REQUEST_CLASSIFICATION_EVAL_CASES` is a synthetic corpus of reads, reasoning tasks, writes, destructive actions,
external side effects, mixed requests, and adversarial informational phrasing. Mixed executable actions use the corpus
label precedence `destructive > external_side_effect > write > read > unknown`. Add cases with a unique ID, synthetic
request, explicit expected pair, tool-availability flag, and tags; avoid multi-label expectations that hide errors.

The result is JSON-serializable and includes exact and component accuracy, precision/recall/support, confusion
matrices, unknown/fallback/error rates, latency statistics, and safety-weighted under- and over-classification case
IDs. Under-classification means an expected mutating class was predicted at a lower action severity; it is an offline
signal only and does not affect authorization.

Use `evaluateClassificationReplay(...)` with normalized `{ caseId, result }` entries to reproduce evaluations without
calling a provider or storing production prompts. Deterministic tests run with
`pnpm --filter @truefoundry/trueforge-core test -- RequestClassificationEvaluation.test.ts`. A live runner is not
included because core has no canonical Needle transport; consumers can pass their configured `RequestClassifier` to
`evaluateRequestClassifier(...)` and serialize the returned report. This keeps live network evaluation explicit and
out of CI.

The normalized classifier contract does not expose pre-threshold provider responses, so the harness does not perform
a threshold sweep or distinguish timeout, transport, and malformed opaque fallbacks. It reports thrown classifier
errors separately, low-confidence normalized results separately, and other `unknown`/zero-confidence outcomes as
opaque fallbacks without changing the production threshold.

### Shadow fast-path admission

`shadowFastPathAdmission(...)` evaluates whether a completed main-model tool choice would meet a hypothetical
read-only fast-path policy. It is disabled by default and only records request metadata and metadata-only logs. It
cannot skip the model, invoke tools, alter approvals, or route execution.

Admission fails closed unless classification is a sufficiently confident `simple`/`read`, exactly one registered tool
was selected, its final arguments match the canonical tool schema, approval is explicitly not required, no policy
veto exists, and the `{ serverId, toolName }` pair appears in the explicit `eligibleTools` allowlist. Names,
descriptions, MCP annotations, and classification alone never opt in a tool. Missing facts reject admission, and all
failed gates are returned as machine-readable reasons.

The result is request-scoped and non-durable. Evaluation occurs after the main model's selected tool call and final
arguments have been persisted, using the approval decision already resolved by the normal tool policy. Normal
approval and execution then continue unchanged. Exactly-one-tool is the available single-action signal; mixed intent
must also be rejected by conservative request classification, so uncertain classifications remain ineligible.

### Validating classifier and admission together

Classifier evaluation measures label quality on `REQUEST_CLASSIFICATION_EVAL_CASES`; admission evaluation combines a
normalized classification with realistic, explicit runtime facts from `FAST_PATH_ADMISSION_EVAL_CASES`. The admission
corpus records selected canonical tool keys, schema-validation status, approval status, policy veto status, explicit
eligible tools, and expected eligibility. Do not add invented defaults to the classifier corpus.

Call `evaluateFastPathAdmission(...)` with either a consumer-supplied `RequestClassifier` or normalized replay entries.
The same production classifier and admission contracts are used without constructing an `AgentThread`:

```ts
const evaluation = await evaluateFastPathAdmission({
  classifier: myConfiguredClassifier,
  cases: FAST_PATH_ADMISSION_EVAL_CASES,
  replay: [],
});
```

For provider comparison, persist normalized `{ caseId, classification }` entries and pass them as `replay` without a
classifier. `simulateFastPathAdmissionThresholds(...)` creates fresh policies for thresholds such as `0.8` through
`0.99`; it never mutates the production default. `createFastPathEvaluationArtifact(...)` returns a JSON-safe
`{ classifier, timestamp, summary, thresholdSimulation, cases }` value. Consumers may explicitly write
`JSON.stringify(artifact, null, 2)` to `fast-path-eval.json`; core performs no filesystem, credential, or network work.
Artifact requests are omitted by default; set `includeRequests: true` only for synthetic or explicitly approved text.

`unsafeEligibleCount` counts eligible cases whose expected action is `write`, `destructive`, or
`external_side_effect`. Overall accuracy is insufficient: one unsafe eligible case is more important than many missed
read optimizations. Provisional prerequisites for any future active path are zero unsafe/write/destructive/external
eligibility, a real-provider evaluation, explicit allowlisting of every eligible tool, continued exclusion of
approval-required tools, and mandatory canonical argument validation. These are prerequisites, not proof of safety.

Existing shadow logs support aggregation of evaluated/eligible/rejected counts, rejection reasons, safe canonical tool
keys, classification categories, and confidence distributions. They intentionally omit prompts, arguments, results,
credentials, and conversation history.

### Live Needle validation

This repository does not own a Needle endpoint or transport. To evaluate a real deployment, provide an ESM module via
`NEEDLE_EVAL_CLIENT_MODULE` that exports a configured `classifier` implementing `RequestClassifier` or
`createClassifier({ timeoutMs })`, plus optional
non-sensitive `provider` and `model` strings. Endpoint, authentication, structured-output parsing, confidence mapping,
and transport timeout remain deployment-owned.

Run one sequential pass with `pnpm eval:needle-live -- --runs 1`, then use `--runs 5` only after the first pass is
healthy. `--timeout-ms` records the configured transport timeout in the artifact; the supplied classifier must enforce
that timeout. The runner performs no tool calls and defaults to sequential requests.

Artifacts are written under `artifacts/needle-eval/<timestamp>/` as `classification.json`,
`fast-path-admission.json`, and `summary.json`. They record normalized results, failures, per-case classification and
admission agreement, unsafe read misclassifications, unsafe admissions, high-confidence errors, and threshold replay.
Credentials, headers, and environment values are never serialized. Classification errors describe provider quality;
admission errors describe the final policy outcome and may remain safe despite a classifier error.

A zero unsafe-admission result on a finite corpus does not prove the fast path is universally safe. It is evidence for
progressively controlled activation, subject to the prerequisites above and review of unstable/adversarial cases.

Both adapters are transport-neutral and disabled by default. Applications own HTTP or in-process clients and their
credential configuration, so enabling neither adapter adds no network dependency.

[Documentation](https://trueforge.dev) · [npm](https://www.npmjs.com/package/@truefoundry/trueforge-core) · [GitHub](https://github.com/truefoundry/trueforge)

The agent execution library behind [TrueForge](https://trueforge.dev): the runtime that runs the agent loop — model calls, MCP tools, skills, sandboxing, approvals, context management, and session state.

## Use TrueForge instead

This package is the library the TrueForge server is built on. It is **not** a complete product on its own.

If you want HTTP APIs, a TypeScript SDK, and a chat UI, use [`@truefoundry/trueforge`](https://www.npmjs.com/package/@truefoundry/trueforge) and start at **[trueforge.dev](https://trueforge.dev)**.

```bash
npx @truefoundry/trueforge
```

- [Quickstart](https://trueforge.dev/quickstart)
- [HTTP API & SDK](https://trueforge.dev/api/overview)
- [Chat UI](https://trueforge.dev/chat-ui)

## Compatibility

`@truefoundry/trueforge-core` does **not** offer backward compatibility guarantees at this time. Public APIs and types may change in any release. Pin an exact version if you depend on this package.

## License

[MIT](https://github.com/truefoundry/trueforge/blob/main/LICENSE)
