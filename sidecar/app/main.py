"""Prom9 local sidecar — FastAPI app factory + uvicorn entrypoint.

Replaces bridge/server.cjs. Binds to 127.0.0.1:8765 by default (same port/env
vars as the old Node bridge):

  FLEX_BRIDGE_PORT  port    (default 8765)
  FLEX_BRIDGE_HOST  host    (default 127.0.0.1 — set 0.0.0.0 to expose on LAN,
                             same caveat as the old bridge: anyone on the
                             network can drive claude/codex on this machine)

Run:  uvicorn app.main:app --port 8765          (from sidecar/)
  or: python -m app.main
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import ai, bridge, images, promptkit, risk

DEFAULT_PORT = 8765
DEFAULT_HOST = "127.0.0.1"


def create_app() -> FastAPI:
    app = FastAPI(
        title="Prom9 Sidecar",
        description=(
            "Local sidecar for flex-promo-builder — AI content, image generation, "
            "background cutout, prompt kit, multi-size export, and the Thai "
            "health-claim risk checker. Drop-in replacement for bridge/server.cjs."
        ),
        version="0.1.0",
    )
    # Same permissive CORS as bridge/server.cjs (extension/panel origins vary).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["content-type"],
    )
    app.include_router(bridge.router)
    app.include_router(ai.router)
    app.include_router(images.router)
    app.include_router(promptkit.router)
    app.include_router(risk.router)
    return app


app = create_app()


def main() -> None:
    import uvicorn

    port = int(os.environ.get("FLEX_BRIDGE_PORT") or DEFAULT_PORT)
    host = os.environ.get("FLEX_BRIDGE_HOST") or DEFAULT_HOST
    print(f"Prom9 sidecar → http://{host}:{port}  (POST /run · /edit · /genimage · GET /ping · /docs)")
    if host == "0.0.0.0":  # noqa: S104 — explicit opt-in, same warning as the old bridge
        print("⚠️  เปิดให้ทั้ง LAN เข้าถึง — ใครในเครือข่ายก็สั่ง claude/codex ผ่านเครื่องนี้ได้ ใช้เฉพาะเน็ตที่ไว้ใจ")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
