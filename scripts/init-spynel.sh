#!/usr/bin/env bash
set -Eeuo pipefail

workspace="${SPYNEL_WORKSPACE:-/data/spynel/workspace}"
config="${workspace}/.spynel/config.yaml"

mkdir -p "${workspace}"
if [[ ! -f "${config}" ]]; then
  printf '%s\n' '[integration] initializing Spynel workspace'
  spynel init --dir "${workspace}" --no-start
fi

if [[ -n "${OPENCODE_WINDOWS_ACP_TOKEN:-}" && -z "${OPENCODE_WINDOWS_ACP_URL:-}" ]] || \
   [[ -z "${OPENCODE_WINDOWS_ACP_TOKEN:-}" && -n "${OPENCODE_WINDOWS_ACP_URL:-}" ]]; then
  printf '%s\n' '[integration] OPENCODE_WINDOWS_ACP_URL and OPENCODE_WINDOWS_ACP_TOKEN must be provided together' >&2
  exit 1
fi

if [[ -n "${OPENCODE_WINDOWS_ACP_URL:-}" && "${OPENCODE_WINDOWS_ACP_URL}" != wss://* ]]; then
  printf '%s\n' '[integration] remote OpenCode requires a wss:// endpoint' >&2
  exit 1
fi
