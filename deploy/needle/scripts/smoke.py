from __future__ import annotations

import argparse
import json
import math
import os
import time
from typing import Any

import needle


def confidence(value: Any) -> None:
    if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
        raise AssertionError("non-finite confidence")
    if value is not None and not 0 <= value <= 1:
        raise AssertionError("confidence outside zero-to-one range")


def cosine(left: list[float], right: list[float]) -> float:
    denominator = math.sqrt(sum(item * item for item in left)) * math.sqrt(sum(item * item for item in right))
    return sum(left_item * right_item for left_item, right_item in zip(left, right)) / denominator


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    tool = {
        "name": "git_status",
        "description": "Show git working tree status without changing it.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    }
    agent = needle.Needle(weights=args.model, generation=3, tools=[tool])
    started = time.perf_counter()
    first = agent.complete("Show git status.")
    completion_latency_ms = (time.perf_counter() - started) * 1000
    confidence(first.get("confidence"))
    agent.complete("Remember request A.")
    agent.reset()
    after_reset = agent.complete("Show git status.")
    fresh = needle.Needle(weights=args.model, generation=3, tools=[tool]).complete("Show git status.")
    texts = [
        "git status",
        "show repository status",
        "read package.json",
        "open package manifest",
        "delete branch",
        "git status",
    ]
    embedding_latencies_ms = []
    embeddings = []
    for value in texts:
        started = time.perf_counter()
        embeddings.append(agent.embed(value))
        embedding_latencies_ms.append((time.perf_counter() - started) * 1000)
    if not embeddings or any(not vector for vector in embeddings):
        raise AssertionError("empty embedding")
    dimension = len(embeddings[0])
    if any(len(vector) != dimension or any(not math.isfinite(item) for item in vector) for vector in embeddings):
        raise AssertionError("invalid embedding")
    schema = {
        "type": "object",
        "properties": {
            "owner": {"type": "string"},
            "repo": {"type": "string"},
            "state": {"type": "string", "enum": ["open", "closed"]},
        },
        "required": ["owner", "repo", "state"],
        "additionalProperties": False,
    }
    extraction_schema = {
        "name": "list_pull_requests",
        "description": "Extract repository pull request filters.",
        "parameters": schema,
    }
    started = time.perf_counter()
    extracted = needle.extract(
        "Find the open pull requests for JsonLord/trueforge.", extraction_schema, weights=args.model, generation=3
    )
    extraction_latency_ms = (time.perf_counter() - started) * 1000
    for _ in range(20):
        agent.reset()
        agent.complete("Show git status.")
    print(json.dumps({
        "construction": True,
        "completion_type": type(first).__name__,
        "completion": first,
        "completion_latency_ms": completion_latency_ms,
        "reset_call_comparison": after_reset.get("function_calls") == fresh.get("function_calls"),
        "embedding_dimension": dimension,
        "embedding_norms": [math.sqrt(sum(item * item for item in vector)) for vector in embeddings],
        "embedding_repeat_equal": embeddings[0] == embeddings[5],
        "embedding_latencies_ms": embedding_latencies_ms,
        "cosine_similarities": {
            "git_status_to_repository_status": cosine(embeddings[0], embeddings[1]),
            "package_json_to_package_manifest": cosine(embeddings[2], embeddings[3]),
            "git_status_to_delete_branch": cosine(embeddings[0], embeddings[4]),
        },
        "extraction": extracted,
        "extraction_confidence": None,
        "extraction_latency_ms": extraction_latency_ms,
        "extraction_type": type(extracted).__name__,
        "offline": args.offline,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
