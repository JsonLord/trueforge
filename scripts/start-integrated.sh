#!/usr/bin/env bash
set -Eeuo pipefail

workspace="${SPYNEL_WORKSPACE:-/data/spynel/workspace}"
socket="${SPYNEL_SOCKET:-/run/spynel/api.sock}"
spynel_pid=''
trueforge_pid=''

shutdown() {
  trap - TERM INT EXIT
  if [[ -n "${trueforge_pid}" ]]; then kill -TERM "${trueforge_pid}" 2>/dev/null || true; fi
  if [[ -n "${spynel_pid}" ]]; then kill -TERM "${spynel_pid}" 2>/dev/null || true; fi
  if [[ -n "${trueforge_pid}" ]]; then wait "${trueforge_pid}" 2>/dev/null || true; fi
  if [[ -n "${spynel_pid}" ]]; then wait "${spynel_pid}" 2>/dev/null || true; fi
}
trap shutdown TERM INT EXIT

mkdir -p /data/trueforge/database /data/trueforge/state "${workspace}" "$(dirname "${socket}")"
chmod 0700 "$(dirname "${socket}")"
/app/scripts/init-spynel.sh

printf '%s\n' '[integration] starting Spynel daemon'
spynel serve --config "${workspace}/.spynel/config.yaml" --socket "${socket}" \
  > >(sed -u 's/^/[spynel] /') 2> >(sed -u 's/^/[spynel] /' >&2) &
spynel_pid=$!

for attempt in $(seq 1 100); do
  if ! kill -0 "${spynel_pid}" 2>/dev/null; then
    printf '%s\n' '[integration] Spynel exited before becoming ready' >&2
    exit 1
  fi
  if [[ -S "${socket}" && -f "${socket}.json" ]]; then break; fi
  if [[ "${attempt}" -eq 100 ]]; then
    printf '%s\n' '[integration] timed out waiting for the private Spynel socket' >&2
    exit 1
  fi
  sleep 0.1
done

printf '%s\n' '[integration] starting TrueForge'
node /app/packages/trueforge/dist/main.js \
  > >(sed -u 's/^/[trueforge] /') 2> >(sed -u 's/^/[trueforge] /' >&2) &
trueforge_pid=$!

set +e
wait -n "${spynel_pid}" "${trueforge_pid}"
status=$?
set -e
printf '%s\n' '[integration] a required service exited; stopping the container' >&2
exit "${status}"
