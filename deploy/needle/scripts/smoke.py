from __future__ import annotations

import argparse
import json
import math
import os
from typing import Any

import needle


def confidence(value: Any) -> None:
    if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
        raise AssertionError("non-finite confidence")
    if value is not None and not 0 <= value <= 1:
        raise AssertionError("confidence outside zero-to-one range")


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
    agent = needle.Needle(model=args.model, generation=3, tools=[tool])
    first = agent.complete("Show git status.")
    confidence(getattr(first, "confidence", None))
    agent.complete("Remember request A.")
    agent.reset()
    after_reset = agent.complete("Show git status.")
    fresh = needle.Needle(model=args.model, generation=3, tools=[tool]).complete("Show git status.")
    embeddings = [agent.embed(value) for value in ["git status", "read package.json", "git status"]]
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
    extracted = needle.extract("Find the open pull requests for JsonLord/trueforge.", schema)
    for _ in range(20):
        agent.reset()
        agent.complete("Show git status.")
    print(json.dumps({
        "construction": True,
        "completion_type": type(first).__name__,
        "reset_comparison": str(after_reset) == str(fresh),
        "embedding_dimension": dimension,
        "embedding_repeat_equal": embeddings[0] == embeddings[2],
        "extraction_type": type(extracted).__name__,
        "offline": args.offline,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
