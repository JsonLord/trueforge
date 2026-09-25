from __future__ import annotations

import importlib.metadata
import inspect
import json
import os
import platform

import needle


def signature(value: object) -> str:
    try:
        return str(inspect.signature(value))
    except (TypeError, ValueError):
        return "unavailable"


report = {
    "python": platform.python_version(),
    "package": importlib.metadata.version("cactus-needle"),
    "signatures": {
        "Needle": signature(needle.Needle),
        "Needle.complete": signature(needle.Needle.complete),
        "Needle.embed": signature(needle.Needle.embed),
        "Needle.reset": signature(needle.Needle.reset),
        "Needle.run": signature(needle.Needle.run),
        "needle.extract": signature(needle.extract),
    },
    "configuration": {
        "engine_override_configured": bool(os.environ.get("NEEDLE3_LIB_PATH")),
        "offline": os.environ.get("HF_HUB_OFFLINE") == "1",
        "telemetry_disabled": os.environ.get("NEEDLE_TELEMETRY") == "0"
        and os.environ.get("DO_NOT_TRACK") == "1",
    },
}
print(json.dumps(report, indent=2, sort_keys=True))
