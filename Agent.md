# Agent Deployment & Operational Guide

This document informs agents about deployment best practices, API endpoints, operational tricks, and ongoing maintenance for the TrueForge codebase running on Hugging Face Spaces.

---

## 1. Deployment Configuration

### Target Space
- **Profile:** `Leon4gr45`
- **Space:** `Trueforge`
- **Full Identifier:** `Leon4gr45/Trueforge`
- **Frontend Port:** `7860` (mandatory for Hugging Face Spaces)

### Deployment Method
- **SDK:** `docker`
- **Port:** `7860` (configured via `ENV PORT=7860` in `Dockerfile` and `app_port: 7860` in `README.md` frontmatter)

### Environment Variables & Credentials
- **HF Token:** Read dynamically from the environment variable (`HF_TOKEN` or execution-time token). **Never hardcode the API token in source code.**
- All CLI commands and log-streaming requests use `Authorization: Bearer <HF_TOKEN>`.

### Key Deployment Files
- `Dockerfile`: Multi-stage Docker build installing dependencies and starting `packages/trueforge/dist/main.js` listening on port `7860`.
- `README.md`: Includes Hugging Face YAML frontmatter:
  ```yaml
  ---
  title: Trueforge
  sdk: docker
  app_port: 7860
  ---
  ```
- `.hfignore`: Excludes `.git`, `node_modules`, and build caches from uploads.
- `Agent.md`: This operational and deployment guide.

---

## 2. API Exposure and Documentation

### Mandatory Endpoints
- **`/health`**
  - **Method:** GET
  - **Purpose:** Health check endpoint required by Hugging Face Space to transition status from *starting* to *running*. Returns `{"status":"ok","version":"..."}` with HTTP 200.
- **`/api-docs`**
  - **Method:** GET
  - **Purpose:** Swagger UI API documentation page listing all available endpoints. Reachable at `https://leon4gr45-trueforge.hf.space/api-docs`.

### Functional Endpoints

#### `/api/v1/sessions`
- **Method:** POST
- **Purpose:** Create a new agent session.
- **Request:**
  ```json
  {
    "agent_id": "optional-agent-id",
    "metadata": {}
  }
  ```
- **Response:**
  ```json
  {
    "id": "session-id",
    "status": "active"
  }
  ```

#### `/api/v1/sessions/:id/turns`
- **Method:** POST
- **Purpose:** Post a message turn into an active session and execute model inference / tools.
- **Request:**
  ```json
  {
    "message": {
      "role": "user",
      "content": "Hello world"
    }
  }
  ```
- **Response:** SSE stream or turn payload schema.

#### `/api/v1/models`
- **Method:** GET
- **Purpose:** List configured model providers and models available for invocation.

#### `/api/v1/agents`
- **Method:** GET / POST
- **Purpose:** Register and retrieve agent configurations.

All endpoints listed above are documented in detail via OpenAPI spec served at `/api/v1/openapi.json` and interactive docs at `/api-docs`.

---

## 3. Deployment Workflow & Troubleshooting

### Precondition: Clean Target Repository
Before pushing new releases, ensure no extraneous files exist in the Hugging Face Space.
To check repo contents or delete files:
```bash
export HF_TOKEN="<token>"
export PATH="/home/jules/.pyenv/shims:$PATH"

# Upload codebase to HF space
hf upload Leon4gr45/Trueforge . . --repo-type=space
```

### Log Monitoring & Iterative Fixes
Stream build and runtime logs via SSE endpoints:

```bash
# Stream build logs
curl -N -H "Authorization: Bearer <HF_TOKEN>" \
  "https://huggingface.co/api/spaces/Leon4gr45/Trueforge/logs/build"

# Stream run logs (once build succeeds)
curl -N -H "Authorization: Bearer <HF_TOKEN>" \
  "https://huggingface.co/api/spaces/Leon4gr45/Trueforge/logs/run"
```

Monitor for 300 seconds to verify that the container initializes, binds to port `7860`, and responds with HTTP 200 on `/health`. If build or run logs indicate errors, fix the code locally, re-upload, and monitor again.
