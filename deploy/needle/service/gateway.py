from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import Any, Callable

from .backend import NeedleBackend
from .contracts import classification, extraction, vectors


class BackendTimeoutError(TimeoutError):
    pass


class BackendContractError(RuntimeError):
    pass


class SerializedGateway:
    """Serializes access so late stateful inference cannot overlap a later request."""

    def __init__(self, backend: NeedleBackend, timeout_seconds: float = 3.0):
        self.backend = backend
        self.timeout_seconds = timeout_seconds
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="needle")

    def _call(self, operation: Callable[[], dict[str, Any]]) -> tuple[dict[str, Any], dict[str, float]]:
        submit_time = time.perf_counter()

        def wrapped() -> tuple[dict[str, Any], dict[str, float]]:
            start_exec_time = time.perf_counter()
            queue_wait_ms = round((start_exec_time - submit_time) * 1000, 2)
            result = operation()
            end_exec_time = time.perf_counter()
            exec_ms = round((end_exec_time - start_exec_time) * 1000, 2)
            total_ms = round((end_exec_time - submit_time) * 1000, 2)
            metrics = {
                "queueWaitMs": queue_wait_ms,
                "executionMs": exec_ms,
                "totalMs": total_ms,
            }
            return result, metrics

        future = self._executor.submit(wrapped)
        try:
            return future.result(timeout=self.timeout_seconds)
        except TimeoutError as caught:
            raise BackendTimeoutError("Needle operation timed out; underlying work remains serialized") from caught

    def classify(self, request: str, tools_available: bool) -> dict[str, Any]:
        try:
            result, metrics = self._call(lambda: self.backend.classify(request, tools_available))
            return classification(result, metrics=metrics)
        except ValueError as caught:
            raise BackendContractError("Needle classification violated its contract") from caught

    def embed(self, inputs: list[str]) -> dict[str, Any]:
        try:
            result, metrics = self._call(lambda: self.backend.embed(inputs))
            return vectors(result, len(inputs), metrics=metrics)
        except ValueError as caught:
            raise BackendContractError("Needle embeddings violated their contract") from caught

    def extract(self, request: str, tool: dict[str, str], schema: dict[str, Any]) -> dict[str, Any]:
        try:
            result, metrics = self._call(lambda: self.backend.extract(request, tool, schema))
            return extraction(result, metrics=metrics)
        except ValueError as caught:
            raise BackendContractError("Needle extraction violated its contract") from caught

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
