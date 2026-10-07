# TrueForge + Spynel Docker Space

This repository contains one image with the TrueForge web server and the complete Spynel runtime. TrueForge is the only public listener (`0.0.0.0:7860`). Spynel remains a resident, independently supervised process and exposes its existing authenticated application API only through `/run/spynel/api.sock`.

> **Integration status:** the unified source layout, private client/adapter, first-run initialization, supervision, and deterministic adapter tests are implemented. Registration of the permanent Spynel library entry and dispatch through the production TrueForge session API are still required before this image is ready for Hugging Face deployment. Do not deploy it as the requested finished Space yet.

## Architecture and ownership

```text
browser -> TrueForge :7860 -> SpynelChatAdapter -> /run/spynel/api.sock -> full Spynel
                         \-> native TrueForge agents (models, MCP, skills, sandbox)

WhatsApp/Telegram -----------------------------------------------> Spynel
Spynel -> custom ACP stdio bridge -> WSS :443 -> remote OpenCode (planned wiring)
```

Spynel is not an ordinary TrueForge manifest. It owns its conversation history, elected-primary lifecycle, goals, tasks, jobs, harness sessions, WhatsApp and Telegram channels. The adapter persists only the deterministic TrueForge-session mapping, last applied event cursor and a bounded event-ID deduplication window. Normal TrueForge agents remain independent.

The source import is a plain copy under `services/spynel`; no Spynel package is scattered into the TypeScript packages. The imported snapshot entered this repository in TrueForge commit `bcabd6de313cf3473c44ec7244dbab25e10054e3`. The import commit did not retain the source Spynel revision, so that exact upstream revision must be recorded before future synchronization.

## Build and local run

The image builds Spynel with its native Go command and TrueForge with the root workspace script:

```bash
docker build -t trueforge-spynel .
docker volume create trueforge-spynel-data
docker run --rm --name trueforge-spynel \
  -p 7860:7860 \
  -v trueforge-spynel-data:/data \
  trueforge-spynel
```

Builds do not need provider credentials, channel secrets, a gateway URL, or a remote OpenCode connection. The same image is intended for local validation and Hugging Face.

Runtime layout:

- `/app`: immutable source and build output;
- `/data/trueforge/database/trueforge.sqlite`: standalone TrueForge database;
- `/data/trueforge/state`: integration-owned TrueForge state;
- `/data/spynel/workspace/.spynel`: full persistent Spynel configuration, histories, tasks, goals, harness sessions and WhatsApp database;
- `/run/spynel/api.sock` and `.json`: ephemeral mode-`0600` socket and native descriptor in a mode-`0700` directory.

On an empty volume, `scripts/init-spynel.sh` calls `spynel init --dir /data/spynel/workspace --no-start`. Existing workspaces are reused and never reset. The supervisor then starts:

```bash
spynel serve \
  --config /data/spynel/workspace/.spynel/config.yaml \
  --socket /run/spynel/api.sock
```

It waits for both native socket artifacts before starting `packages/trueforge/dist/main.js`. `dumb-init` is PID 1. If either required child exits, the other receives `SIGTERM` and the container exits. `SIGINT` and `SIGTERM` stop and reap both children.

## Adapter contract

`integrations/spynel/client/SpynelClient.ts` reads and validates the native private descriptor for every connection, supplies its bearer credential only in the local authorization header, bounds bodies, and supports health, status, conversation snapshots, messages and cursor-based events. It never accepts a browser-selected URL or socket path.

A TrueForge session maps to `trueforge-<32 lowercase hex characters>`, derived deterministically from SHA-256. A message uses channel `cli`, sender `trueforge`, and its original stable `source_message_id`. An interrupted or prematurely closed response is reported as ambiguous; callers must inspect committed history before deciding whether to retry and must not mint a replacement source ID.

Committed events are applied before cursor persistence. Event IDs are deduplicated, and `/v1/conversation` is the resynchronization/history authority. Stop is the existing `/stop` application command, not a process signal. The production TrueForge session/event routing that consumes this adapter remains an explicit blocker.

## Channels

WhatsApp and Telegram are native Spynel transports. TrueForge does not proxy, reinterpret or impersonate either channel. Their settings live in the persisted Spynel workspace. WhatsApp's default database resolves beneath `.spynel/whatsapp.db`. Telegram defaults to supported polling mode, avoiding a second public port and webhook routing in the first Space deployment.

No automated test sends a WhatsApp or Telegram message. Pairing data, tokens, phone identifiers and allowlists must never be copied into logs or browser responses.

## Runtime OpenCode configuration

The reserved runtime settings are:

```text
OPENCODE_WINDOWS_ACP_URL=wss://opencode.example.com/acp
OPENCODE_WINDOWS_ACP_TOKEN=<secret>
```

They must be supplied only to `docker run` or as Hugging Face Variable/Secret values. The initializer validates that both are present together and requires `wss://`; it does not print either value. The current Spynel import supports a shell-free custom ACP command and arguments, but this repository does **not** yet contain the requested bounded stdio-to-WSS `spynel-remote-acp` bridge. Consequently these variables are validated but not registered into Spynel yet. This is a deployment blocker, not a hidden fallback. Spynel still starts when the target is absent.

## Health and administration

TrueForge retains `/healthz`. The client can query Spynel's authenticated `/v1/health` and `/v1/status`, and the integration exposes a redacted status projection that reports only availability plus whether the named Windows OpenCode target is configured. A combined authenticated readiness route, permanent library entry, Spynel status/connections view, and typed restart action remain to be wired.

There is deliberately no browser terminal, PTY, arbitrary command endpoint, SSH daemon, raw environment view or config dump. Routine administration must become typed and bounded. Deep maintenance should use Hugging Face Dev Mode SSH/VS Code when available.

## Dev Mode

The runtime uses UID/GID `1000`, has Bash, Git, curl, wget, procps and the Spynel CLI, and keeps `/app` readable and `/data` writable. Useful non-browser diagnostics are:

```bash
ps aux
curl --fail http://127.0.0.1:7860/healthz
spynel status --config /data/spynel/workspace/.spynel/config.yaml
spynel tasks --config /data/spynel/workspace/.spynel/config.yaml
spynel goals --config /data/spynel/workspace/.spynel/config.yaml
spynel jobs --config /data/spynel/workspace/.spynel/config.yaml
```

Edits under `/app` are disposable and should be committed and rebuilt. Persistent operational state belongs under `/data`.

## Hugging Face preparation

The initial Hugging Face deployment must be configured as a **PRIVATE SPACE** because TrueForge runs with `STANDALONE=true` and does not provide public authentication in this baseline.

The Docker Space should use:

- public port/Variable: `PORT=7860`;
- persistent storage mounted at `/data`;
- optional Variable: `PUBLIC_BASE_URL`;
- optional Variable: `OPENCODE_WINDOWS_ACP_URL`;
- Secret: `OPENCODE_WINDOWS_ACP_TOKEN`;
- provider and native Spynel channel secrets under their documented names.

No HF-only entrypoint is planned. Hugging Face should build and run this Dockerfile unchanged.

## Troubleshooting

- **Spynel missing from the library:** expected until permanent system-agent registration and backend dispatch are completed; do not create a fake ordinary manifest.
- **Socket unavailable:** inspect `[spynel]` startup output and confirm `/run/spynel` is owned by UID 1000 with mode `0700`; never publish or persist the socket.
- **Chat disconnected:** treat the request outcome as unknown, load `/v1/conversation`, correlate the original source message ID, and retry only deliberately.
- **TrueForge starts too early:** the supervisor starts it only after both socket and descriptor exist; a timeout terminates startup.
- **Persistent state absent:** ensure a writable volume is mounted at `/data`, not `/app` or `/run`.
- **WhatsApp pairing is not retained:** verify `/data/spynel/workspace/.spynel/whatsapp.db` lives on the mounted volume without displaying its contents.
- **Remote OpenCode unavailable:** Spynel should remain available. Confirm both runtime variables exist and the URL is the final `wss://` endpoint on standard port 443. Bridge implementation is still required.
- **ACP secret missing:** URL and token are an atomic pair; startup rejects a half-configured pair without printing either value.
- **Dev Mode edits disappear:** `/app` is immutable deployment content; commit changes and rebuild. Keep only runtime configuration/state in `/data`.
