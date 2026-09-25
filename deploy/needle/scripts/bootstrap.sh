#!/usr/bin/env bash
set -euo pipefail

ROOT="${NEEDLE_HOME:-$HOME/.local/share/trueforge/needle}"
PYTHON="${PYTHON:-python3.13}"
VENV="$ROOT/venv"
DOWNLOADS="$ROOT/downloads"
ENGINE_DIR="$ROOT/engine"
MODEL_DIR="$ROOT/model"
WHEEL="cactus_needle-3.0.5-py3-none-any.whl"
WHEEL_SHA256="3987dd18f7fdd4954b92e75e8be08c37ccd0b1f898ed19a1267770cf1be20816"
MODEL_REVISION="3e8e2a66057a29694052d915128b91b53e7e5ead"
MODEL_SHA256="c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38"
MODEL_SIZE="35335380"
ENGINE_REVISION="b274efcb211a9eef48c9a88da4b43bd569696a39"
ENGINE_WHEEL="cactus_needle-3.0.1-py3-none-manylinux2014_x86_64.whl"
ENGINE_WHEEL_SHA256="05770ef9a85686583968ea15f62f9ad44217e078efdaa99559d3208bb8a369b0"
ENGINE_SHA256="978fce130aac08af506b5fe8bb2950da58e9479d0de69d972d9bd69db953568d"

export NEEDLE_TELEMETRY=0
export DO_NOT_TRACK=1
export HF_HOME="$ROOT/cache/huggingface"
export XDG_CACHE_HOME="$ROOT/cache"

"$PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 13), "Python 3.13 is required"'
mkdir -p "$DOWNLOADS" "$ENGINE_DIR" "$MODEL_DIR"
"$PYTHON" -m pip download --no-deps --index-url https://pypi.org/simple --dest "$DOWNLOADS" 'cactus-needle==3.0.5'
printf '%s  %s\n' "$WHEEL_SHA256" "$DOWNLOADS/$WHEEL" | sha256sum --check --strict
"$PYTHON" -m venv "$VENV"
"$VENV/bin/python" -m pip install --index-url https://pypi.org/simple "$DOWNLOADS/$WHEEL"
ENGINE_WHEEL_URL="https://huggingface.co/Cactus-Compute/needle3/resolve/$ENGINE_REVISION/python/$ENGINE_WHEEL"
"$VENV/bin/python" - "$ENGINE_WHEEL_URL" "$DOWNLOADS/$ENGINE_WHEEL" <<'PY'
import sys
import urllib.request

url, destination = sys.argv[1:]
with urllib.request.urlopen(url) as response, open(destination, "wb") as output:
    while chunk := response.read(1024 * 1024):
        output.write(chunk)
PY
printf '%s  %s\n' "$ENGINE_WHEEL_SHA256" "$DOWNLOADS/$ENGINE_WHEEL" | sha256sum --check --strict
"$VENV/bin/python" - "$DOWNLOADS/$ENGINE_WHEEL" "$ENGINE_DIR/libneedle.so" <<'PY'
import sys
import zipfile

wheel, destination = sys.argv[1:]
with zipfile.ZipFile(wheel) as archive, open(destination, "wb") as output:
    output.write(archive.read("needle/libneedle3.so"))
PY
printf '%s  %s\n' "$ENGINE_SHA256" "$ENGINE_DIR/libneedle.so" | sha256sum --check --strict

MODEL_URL="https://huggingface.co/Cactus-Compute/needle3/resolve/$MODEL_REVISION/needle3.cact"
"$VENV/bin/python" - "$MODEL_URL" "$MODEL_DIR/needle3.cact" <<'PY'
import sys
import urllib.request

url, destination = sys.argv[1:]
with urllib.request.urlopen(url) as response, open(destination, "wb") as output:
    while chunk := response.read(1024 * 1024):
        output.write(chunk)
PY

test "$(wc -c < "$MODEL_DIR/needle3.cact")" = "$MODEL_SIZE"
printf '%s  %s\n' "$MODEL_SHA256" "$MODEL_DIR/needle3.cact" | sha256sum --check --strict
"$VENV/bin/python" -m pip freeze --all > "$ROOT/requirements.lock"
find "$ENGINE_DIR" -type f -print0 | sort -z | xargs -0 sha256sum > "$ROOT/engine-sha256.txt"
if command -v file >/dev/null; then
    find "$ENGINE_DIR" -type f -exec file {} \; > "$ROOT/engine-file.txt"
elif command -v readelf >/dev/null; then
    readelf --file-header "$ENGINE_DIR/libneedle.so" > "$ROOT/engine-file.txt"
else
    printf 'file and readelf unavailable; ELF identity verified by hash and ldd\n' > "$ROOT/engine-file.txt"
fi
find "$ENGINE_DIR" -type f -name '*.so' -exec sh -c 'ldd "$1" || true' _ {} \; > "$ROOT/engine-ldd.txt" 2>&1
cat > "$ROOT/runtime.env" <<EOF
NEEDLE_HOST=127.0.0.1
NEEDLE_PORT=8792
NEEDLE_TELEMETRY=0
DO_NOT_TRACK=1
HF_HOME=$HF_HOME
XDG_CACHE_HOME=$XDG_CACHE_HOME
NEEDLE_MODEL_PATH=$MODEL_DIR/needle3.cact
NEEDLE3_LIB_PATH=$ENGINE_DIR/libneedle.so
EOF
printf 'Needle runtime installed under %s\n' "$ROOT"
printf 'Set NEEDLE3_LIB_PATH to the verified libneedle.so recorded in %s\n' "$ROOT/engine-sha256.txt"
