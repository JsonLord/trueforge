from __future__ import annotations

import json
import threading
import time
import unittest
import urllib.error
import urllib.request
from typing import Any

from deploy.needle.service.app import create_server
from deploy.needle.service.backend import CactusNeedleBackend, RuntimeUnavailableError
from deploy.needle.service.contracts import ContractError, classification, extraction, vectors
from deploy.needle.service.gateway import BackendContractError, BackendTimeoutError, SerializedGateway


class FakeNeedleBackend:
    runtime_verified = True
    health_status = "ready"

    def __init__(self) -> None:
        self.classification: Any = {"complexity": "simple", "actionClass": "read", "confidence": 0.97}
        self.vectors: Any = {"vectors": [[1.0, 0.0]]}
        self.extraction: Any = {"arguments": {"owner": "JsonLord"}, "confidence": 0.94}
        self.delay = 0.0
        self.error: Exception | None = None
        self.calls: list[str] = []

    def _result(self, name: str, result: Any) -> Any:
        self.calls.append(name)
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error
        return result

    def classify(self, request: str, tools_available: bool) -> dict[str, Any]:
        return self._result(f"classify:{request}:{tools_available}", self.classification)

    def embed(self, inputs: list[str]) -> dict[str, Any]:
        return self._result(f"embed:{len(inputs)}", self.vectors)

    def extract(self, request: str, tool: dict[str, str], schema: dict[str, Any]) -> dict[str, Any]:
        return self._result(f"extract:{request}:{tool['toolName']}", self.extraction)


class ContractTests(unittest.TestCase):
    def test_classification_variants(self) -> None:
        for complexity in ("simple", "reasoning", "unknown"):
            for action in ("read", "write", "destructive", "external_side_effect", "unknown"):
                result = classification({"complexity": complexity, "actionClass": action, "confidence": 0.5})
                self.assertEqual(result["actionClass"], action)

    def test_classification_rejects_malformed_outputs(self) -> None:
        invalid = [
            {"complexity": "fast", "actionClass": "read", "confidence": 1},
            {"complexity": "simple", "actionClass": "execute", "confidence": 1},
            {"complexity": "simple", "actionClass": "read"},
            {"complexity": "simple", "actionClass": "read", "confidence": -1},
            {"complexity": "simple", "actionClass": "read", "confidence": 2},
            {"complexity": "simple", "actionClass": "read", "confidence": float("nan")},
            {"complexity": "simple", "actionClass": "read", "confidence": float("inf")},
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ContractError):
                classification(value)

    def test_embedding_validation(self) -> None:
        self.assertEqual(vectors({"vectors": [[1, 2], [3.0, 4.0]]}, 2), {"vectors": [[1.0, 2.0], [3.0, 4.0]]})
        invalid = [
            ({"vectors": []}, 1),
            ({}, 1),
            ({"vectors": [[1], [2]]}, 1),
            ({"vectors": [[1], [1, 2]]}, 2),
            ({"vectors": [[float("nan")]]}, 1),
            ({"vectors": [[float("inf")]]}, 1),
            ({"vectors": [["1"]]}, 1),
            ({"vectors": [[]]}, 1),
        ]
        for value, count in invalid:
            with self.subTest(value=value), self.assertRaises(ContractError):
                vectors(value, count)

    def test_extraction_validation(self) -> None:
        for arguments in ({"state": "open"}, {"nested": {"items": [1, 2]}}, {"values": ["open"]}):
            self.assertEqual(extraction({"arguments": arguments, "confidence": None})["arguments"], arguments)
        self.assertIsNone(extraction({"arguments": {}})["confidence"])
        for value in ({"arguments": "bad", "confidence": 1}, {"arguments": {}, "confidence": 3}):
            with self.subTest(value=value), self.assertRaises(ContractError):
                extraction(value)


class GatewayTests(unittest.TestCase):
    def test_operations_are_serialized_and_isolated(self) -> None:
        backend = FakeNeedleBackend()
        backend.vectors = {"vectors": [[1.0]]}
        gateway = SerializedGateway(backend)
        results: list[Any] = []
        threads = [
            threading.Thread(target=lambda: results.append(gateway.classify("A", True))),
            threading.Thread(target=lambda: results.append(gateway.embed(["B"]))),
            threading.Thread(target=lambda: results.append(gateway.extract("C", {"toolName": "t"}, {}))),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(results), 3)
        self.assertEqual(len(backend.calls), 3)
        gateway.close()

    def test_timeout_does_not_overlap_next_request(self) -> None:
        backend = FakeNeedleBackend()
        backend.delay = 0.04
        gateway = SerializedGateway(backend, timeout_seconds=0.01)
        with self.assertRaises(BackendTimeoutError):
            gateway.classify("A", True)
        backend.delay = 0
        time.sleep(0.05)
        self.assertEqual(gateway.classify("B", False)["complexity"], "simple")
        self.assertEqual(backend.calls, ["classify:A:True", "classify:B:False"])
        gateway.close()

    def test_backend_exception_and_runtime_unavailable(self) -> None:
        backend = FakeNeedleBackend()
        backend.error = RuntimeError("secret request text")
        gateway = SerializedGateway(backend)
        with self.assertRaises(RuntimeError):
            gateway.classify("private", True)
        gateway.close()
        unavailable = CactusNeedleBackend.create()
        with self.assertRaises(RuntimeUnavailableError):
            unavailable.classify("request", False)

    def test_malformed_backend_output_is_not_a_caller_error(self) -> None:
        backend = FakeNeedleBackend()
        backend.classification = {"complexity": "invalid", "actionClass": "read", "confidence": 1}
        gateway = SerializedGateway(backend)
        with self.assertRaises(BackendContractError):
            gateway.classify("request", True)
        gateway.close()


class HttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.backend = FakeNeedleBackend()
        self.gateway = SerializedGateway(self.backend)
        self.server = create_server(self.gateway, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.gateway.close()

    def request(self, path: str, body: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.url + path, data=data, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_health_and_endpoints(self) -> None:
        self.assertEqual(self.request("/health")[1]["status"], "ready")
        for status in ("starting", "degraded", "failed"):
            self.backend.health_status = status
            self.assertEqual(self.request("/health")[1]["status"], status)
        self.backend.health_status = "ready"
        self.assertEqual(self.request("/v1/classify", {"request": "status", "toolsAvailable": True})[0], 200)
        self.assertEqual(self.request("/v1/embed", {"inputs": ["status"]})[1]["vectors"], [[1.0, 0.0]])
        self.assertEqual(
            self.request(
                "/v1/extract",
                {"request": "list prs", "tool": {"serverId": "github", "toolName": "list"}, "schema": {}},
            )[1]["arguments"],
            {"owner": "JsonLord"},
        )

    def test_invalid_request_backend_error_timeout_and_unavailable(self) -> None:
        self.assertEqual(self.request("/v1/classify", {"request": "", "toolsAvailable": True})[0], 400)
        self.backend.error = RuntimeError("failure")
        self.assertEqual(self.request("/v1/classify", {"request": "x", "toolsAvailable": True})[0], 500)
        self.backend.error = None
        self.backend.delay = 0.04
        self.gateway.timeout_seconds = 0.01
        self.assertEqual(self.request("/v1/classify", {"request": "x", "toolsAvailable": True})[0], 504)
        self.server.RequestHandlerClass.gateway = SerializedGateway(CactusNeedleBackend.create())
        self.assertEqual(self.request("/health")[1]["status"], "degraded")
        self.assertEqual(self.request("/v1/classify", {"request": "x", "toolsAvailable": True})[0], 503)


if __name__ == "__main__":
    unittest.main()
