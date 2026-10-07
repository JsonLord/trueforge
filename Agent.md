# Hugging Face Space Deployment Agent Guidelines

## Deployment Target

- **Profile:** `Leon4gr45`
- **Space:** `xu`
- **Full Identifier:** `Leon4gr45/xu`
- **Port:** `7860`
- **SDK:** `docker`

## Standard Endpoints

- `/health` — Returns HTTP 200 `{ "status": "ok", "version": "..." }`
- `/healthz` — Returns HTTP 200 `{ "status": "ok", "version": "..." }`
- `/api-docs` — Serves Swagger UI documentation for all endpoints
- `/api/v1/docs` — Serves Swagger UI
- `/api/v1/openapi.json` — Serves OpenAPI 3.1 specification

## Key Deployment Tricks & Best Practices

1. **Shared Library Path**:
   Ensure `LD_LIBRARY_PATH=/usr/local/bin/lib` is present in the runtime `ENV` of `Dockerfile` so native Spynel shared libraries (`libsherpa-onnx-c-api.so`, `libonnxruntime.so`) resolve at container boot time.
2. **Build-Time Smoke Checks**:
   Keep `RUN LD_LIBRARY_PATH=/usr/local/bin/lib /usr/local/bin/spynel --version` in the Dockerfile runtime stage to detect linking failures before pushing image layers to HF Spaces.
3. **Private Space Requirement**:
   When running in `STANDALONE=true` mode without public authentication, deploy the Space as a **PRIVATE SPACE** on Hugging Face.
4. **Log Monitoring**:
   Stream deployment logs using bearer token authorization:
   ```bash
   curl -N -H "Authorization: Bearer <HF_TOKEN>" "https://huggingface.co/api/spaces/Leon4gr45/xu/logs/build"
   curl -N -H "Authorization: Bearer <HF_TOKEN>" "https://huggingface.co/api/spaces/Leon4gr45/xu/logs/run"
   ```
