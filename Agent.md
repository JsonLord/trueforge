# Hugging Face Space Deployment Guidelines & Agent Documentation

This document provides instructions, tricks, and best practices for deploying TrueForge onto Hugging Face Spaces.

## 1. Deployment Configuration

### Target Space
- **Profile:** `Leon4gr45`
- **Space:** `xu`
- **Full Identifier:** `Leon4gr45/xu`
- **Frontend Port:** `7860` (mandatory for all Hugging Face Spaces)

### Deployment Method
- **Docker SDK** — default and required SDK for Node.js / monorepo applications.

### HF Token
- Environment variable `HF_TOKEN` (provided at runtime).
- Always read the token from environment or use python `huggingface_hub` SDK. Do not hardcode secret tokens into codebase files.

### Required Files
- `Dockerfile` (multi-stage Docker build configured for port 7860)
- `README.md` with Hugging Face YAML frontmatter:
  ```yaml
  ---
  title: TrueForge
  sdk: docker
  app_port: 7860
  ---
  ```
- `.hfignore` (excludes `node_modules/`, `.venv/`, `.git/`, and `dist/` to remain within Hugging Face repo file limits)
- `Agent.md` (this file, committed before deployment)

---

## 2. API Exposure and Documentation

### Mandatory Endpoints
- **`/health`**: Returns HTTP 200 OK JSON (`{ "status": "ok", "version": "..." }`) required for Hugging Face Space health checks to transition state from *starting* -> *running*.
- **`/api-docs`**: Interactive OpenAPI Swagger UI documentation, reachable at `https://leon4gr45-xu.hf.space/api-docs`.

### Functional Endpoints
- **`/api/v1/openapi.json`**: GET - Returns the OpenAPI 3.1 specification JSON.
- **`/api/v1/docs`**: GET - Interactive OpenAPI documentation UI.
- **`/api/v1/auth/me`**: GET - Returns current session identity and auth mode.
- **`/api/v1/auth/login`**: GET - Redirects to browser login / auth flow.
- **`/api/v1/models`**: GET / POST / PUT / DELETE - Manages model provider configurations.
- **`/api/v1/agents`**: GET / POST / PUT / DELETE - Manages agents.
- **`/api/v1/sessions`**: GET / POST / DELETE - Manages agent sessions and execution turns.

---

## 3. Deployment Workflow

### Precondition
Cleanse target space of leftover or untracked files before uploading:
```python
from huggingface_hub import HfApi
api = HfApi(token=token)
# Delete existing files in space
```

### Upload Command
Upload files using `huggingface_hub` Python SDK or CLI:
```bash
python3 -c "from huggingface_hub import HfApi; HfApi(token='$HF_TOKEN').upload_folder(folder_path='.', repo_id='Leon4gr45/xu', repo_type='space', ignore_patterns=['node_modules/**', '.git/**', '.venv/**', 'dist/**'])"
```

### Monitoring Build and Run Logs
Build logs stream via SSE:
```bash
curl -N -H "Authorization: Bearer $HF_TOKEN" "https://huggingface.co/api/spaces/Leon4gr45/xu/logs/build"
```

Run logs stream via SSE:
```bash
curl -N -H "Authorization: Bearer $HF_TOKEN" "https://huggingface.co/api/spaces/Leon4gr45/xu/logs/run"
```

Iterate on logs until the space status is `RUNNING` and `/health` returns HTTP 200 OK.
