from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .backend import RuntimeUnavailableError
from .contracts import ContractError, object_value, string_value
from .gateway import BackendContractError, BackendTimeoutError, SerializedGateway


class NeedleRequestHandler(BaseHTTPRequestHandler):
    gateway: SerializedGateway

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _write(self, status: HTTPStatus, value: dict[str, Any]) -> None:
        encoded = json.dumps(value, allow_nan=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        return object_value(json.loads(self.rfile.read(length)), "request body")

    def do_GET(self) -> None:
        if self.path != "/health":
            self._write(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        verified = self.gateway.backend.runtime_verified
        status = self.gateway.backend.health_status
        if status not in {"starting", "ready", "degraded", "failed"}:
            status = "failed"
        self._write(
            HTTPStatus.OK,
            {
                "status": status,
                "provider": "needle",
                "generation": 3,
                "classification": verified,
                "embedding": verified,
                "extraction": verified,
                "runtimeVerified": verified,
            },
        )

    def do_POST(self) -> None:
        try:
            body = self._body()
            if self.path == "/v1/classify":
                request = string_value(body.get("request"), "request")
                tools_available = body.get("toolsAvailable")
                if not isinstance(tools_available, bool):
                    raise ContractError("toolsAvailable must be a boolean")
                self._write(HTTPStatus.OK, self.gateway.classify(request, tools_available))
            elif self.path == "/v1/embed":
                inputs = body.get("inputs")
                if not isinstance(inputs, list) or not inputs:
                    raise ContractError("inputs must be a non-empty array")
                validated = [string_value(value, "input") for value in inputs]
                self._write(HTTPStatus.OK, self.gateway.embed(validated))
            elif self.path == "/v1/extract":
                request = string_value(body.get("request"), "request")
                tool = object_value(body.get("tool"), "tool")
                validated_tool = {
                    "serverId": string_value(tool.get("serverId"), "serverId"),
                    "toolName": string_value(tool.get("toolName"), "toolName"),
                }
                schema = object_value(body.get("schema"), "schema")
                self._write(HTTPStatus.OK, self.gateway.extract(request, validated_tool, schema))
            else:
                self._write(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except (ContractError, json.JSONDecodeError, UnicodeDecodeError, ValueError):
            self._write(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})
        except RuntimeUnavailableError:
            self._write(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "runtime_unavailable"})
        except BackendTimeoutError:
            self._write(HTTPStatus.GATEWAY_TIMEOUT, {"error": "timeout"})
        except BackendContractError:
            self._write(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "invalid_backend_response"})
        except Exception:
            self._write(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "backend_error"})


def create_server(gateway: SerializedGateway, host: str, port: int) -> ThreadingHTTPServer:
    class ConfiguredHandler(NeedleRequestHandler):
        pass

    ConfiguredHandler.gateway = gateway
    return ThreadingHTTPServer((host, port), ConfiguredHandler)
