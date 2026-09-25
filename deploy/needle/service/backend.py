from __future__ import annotations

import importlib
import importlib.util
import os
from dataclasses import dataclass
from typing import Any, Protocol


class RuntimeUnavailableError(RuntimeError):
    pass


class NeedleBackend(Protocol):
    @property
    def health_status(self) -> str: ...

    @property
    def runtime_verified(self) -> bool: ...

    def classify(self, request: str, tools_available: bool) -> dict[str, Any]: ...

    def embed(self, inputs: list[str]) -> dict[str, Any]: ...

    def extract(self, request: str, tool: dict[str, str], schema: dict[str, Any]) -> dict[str, Any]: ...


@dataclass
class CactusNeedleBackend:
    """Keeps all pre-introspection cactus-needle assumptions behind one boundary."""

    _needle: Any = None
    _agent: Any = None
    _unavailable_reason: str | None = None

    @classmethod
    def create(cls) -> CactusNeedleBackend:
        if importlib.util.find_spec("needle") is None:
            return cls(_unavailable_reason="cactus-needle is not installed")
        needle = importlib.import_module("needle")
        model = os.environ.get("NEEDLE_MODEL_PATH")
        if not model:
            return cls(_needle=needle, _unavailable_reason="NEEDLE_MODEL_PATH is not configured")
        classifier = {
            "name": "classify_request",
            "description": "Classify request complexity and action without executing it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "complexity": {"type": "string", "enum": ["simple", "reasoning", "unknown"]},
                    "actionClass": {
                        "type": "string",
                        "enum": ["read", "write", "destructive", "external_side_effect", "unknown"],
                    },
                },
                "required": ["complexity", "actionClass"],
                "additionalProperties": False,
            },
        }
        try:
            agent = needle.Needle(weights=model, generation=3, tools=[classifier])
        except Exception as caught:
            return cls(_needle=needle, _unavailable_reason=f"Needle initialization failed: {type(caught).__name__}")
        return cls(_needle=needle, _agent=agent)

    @property
    def runtime_verified(self) -> bool:
        return self._agent is not None and self._unavailable_reason is None

    @property
    def health_status(self) -> str:
        return "ready" if self.runtime_verified else "degraded"

    def _agent_or_raise(self) -> Any:
        if not self.runtime_verified:
            raise RuntimeUnavailableError(self._unavailable_reason or "Needle runtime is unavailable")
        return self._agent

    def classify(self, request: str, tools_available: bool) -> dict[str, Any]:
        agent = self._agent_or_raise()
        agent.reset()
        result = agent.complete(
            "Classify the following user request as simple or reasoning, and read, write, destructive, or "
            f"external_side_effect. Call classify_request. User request: {request}"
        )
        if not isinstance(result, dict):
            raise RuntimeError("Needle returned a malformed classification response")
        calls = result.get("function_calls") or result.get("suppressed_calls")
        if not isinstance(calls, list) or not calls:
            raise RuntimeError("Needle returned no classification proposal")
        call = calls[0]
        if not isinstance(call, dict):
            raise RuntimeError("Needle returned a malformed classification call")
        arguments = call.get("arguments")
        if not isinstance(arguments, dict):
            raise RuntimeError("Needle returned malformed classification arguments")
        return {
            **arguments,
            "confidence": result.get("confidence"),
        }

    def embed(self, inputs: list[str]) -> dict[str, Any]:
        agent = self._agent_or_raise()
        return {"vectors": [agent.embed(value) for value in inputs]}

    def extract(self, request: str, tool: dict[str, str], schema: dict[str, Any]) -> dict[str, Any]:
        self._agent_or_raise()
        extraction_schema = {
            "name": tool["toolName"],
            "description": f"Extract arguments for {tool['toolName']}.",
            "parameters": schema,
        }
        value = self._needle.extract(request, extraction_schema, weights=os.environ["NEEDLE_MODEL_PATH"], generation=3)
        if not isinstance(value, dict):
            raise RuntimeError("Needle returned malformed extraction arguments")
        return {"arguments": value, "confidence": None}
