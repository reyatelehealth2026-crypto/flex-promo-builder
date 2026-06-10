"""Shared helpers for routers — error envelope compatible with bridge/server.cjs."""

from __future__ import annotations

from fastapi.responses import JSONResponse


def err(message: object, status: int = 500) -> JSONResponse:
    """bridge/server.cjs error shape: HTTP 500 + {ok:false, error:"..."}."""
    return JSONResponse({"ok": False, "error": str(message)}, status_code=status)
