from __future__ import annotations

import math
from typing import Any


COMPLEXITIES = frozenset({"simple", "reasoning", "unknown"})
ACTION_CLASSES = frozenset({"read", "write", "destructive", "external_side_effect", "unknown"})


class ContractError(ValueError):
    pass


def object_value(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{name} must be an object")
    return value


def string_value(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be a non-empty string")
    return value


def confidence_value(value: Any, *, nullable: bool = False) -> float | None:
    if nullable and value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError("confidence must be a number")
    result = float(value)
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ContractError("confidence must be finite and between zero and one")
    return result


def classification(value: Any) -> dict[str, Any]:
    result = object_value(value, "classification")
    complexity = result.get("complexity")
    action_class = result.get("actionClass")
    if complexity not in COMPLEXITIES:
        raise ContractError("invalid complexity")
    if action_class not in ACTION_CLASSES:
        raise ContractError("invalid actionClass")
    return {
        "complexity": complexity,
        "actionClass": action_class,
        "confidence": confidence_value(result.get("confidence")),
    }


def vectors(value: Any, expected_count: int) -> dict[str, list[list[float]]]:
    result = object_value(value, "embedding result").get("vectors")
    if not isinstance(result, list) or len(result) != expected_count:
        raise ContractError("vector response count does not match input count")
    dimension: int | None = None
    output: list[list[float]] = []
    for vector in result:
        if not isinstance(vector, list) or not vector:
            raise ContractError("vectors must be non-empty arrays")
        if dimension is None:
            dimension = len(vector)
        if len(vector) != dimension:
            raise ContractError("vectors must have consistent dimensions")
        normalized: list[float] = []
        for item in vector:
            if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
                raise ContractError("vectors must contain finite numbers")
            normalized.append(float(item))
        output.append(normalized)
    return {"vectors": output}


def extraction(value: Any) -> dict[str, Any]:
    result = object_value(value, "extraction result")
    arguments = object_value(result.get("arguments"), "arguments")
    return {"arguments": arguments, "confidence": confidence_value(result.get("confidence"), nullable=True)}
