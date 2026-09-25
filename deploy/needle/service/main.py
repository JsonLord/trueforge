from __future__ import annotations

import os
import signal
import threading

from .app import create_server
from .backend import CactusNeedleBackend
from .gateway import SerializedGateway


def main() -> None:
    host = os.environ.get("NEEDLE_HOST", "127.0.0.1")
    port = int(os.environ.get("NEEDLE_PORT", "8792"))
    gateway = SerializedGateway(CactusNeedleBackend.create())
    server = create_server(gateway, host, port)
    signal.signal(signal.SIGTERM, lambda _signum, _frame: threading.Thread(target=server.shutdown).start())
    try:
        server.serve_forever()
    finally:
        gateway.close()
        server.server_close()


if __name__ == "__main__":
    main()
