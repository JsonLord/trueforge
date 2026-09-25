from __future__ import annotations

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

    def _call(self, operation: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        future = self._executor.submit(operation)
        try:
            return future.result(timeout=self.timeout_seconds)
        except TimeoutError as caught:
            raise BackendTimeoutError("Needle operation timed out; underlying work remains serialized") from caught

    def classify(self, request: str, tools_available: bool) -> dict[str, Any]:
        try:
            return classification(self._call(lambda: self.backend.classify(request, tools_available)))
        except ValueError as caught:
            raise BackendContractError("Needle classification violated its contract") from caught

    def embed(self, inputs: list[str]) -> dict[str, Any]:
        try:
            return vectors(self._call(lambda: self.backend.embed(inputs)), len(inputs))
        except ValueError as caught:
            raise BackendContractError("Needle embeddings violated their contract") from caught

    def extract(self, request: str, tool: dict[str, str], schema: dict[str, Any]) -> dict[str, Any]:
        try:
            return extraction(self._call(lambda: self.backend.extract(request, tool, schema)))
        except ValueError as caught:
            raise BackendContractError("Needle extraction violated its contract") from caught

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
