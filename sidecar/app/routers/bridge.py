"""Drop-in compatible endpoints from bridge/server.cjs.

GET  /ping      -> {ok, service}
POST /run       -> {prompt} -> {ok, text}            (claude -p)
POST /edit      -> {flex, instruction} -> {ok, text} (claude -p, same prompt as the old bridge)
POST /genimage  -> {prompt, refBase64?} -> {ok, base64, mime} (codex exec)

Request bodies are parsed leniently (raw JSON, not pydantic) so error messages
and status codes match the old Node bridge exactly.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..services import cli_runner
from .common import err

router = APIRouter(tags=["bridge-compat"])


@router.get("/ping")
async def ping() -> dict:
    return {"ok": True, "service": "flex-bridge", "implementation": "prom9-sidecar"}


@router.post("/run")
async def run(request: Request):
    """Generic runner: { prompt } -> { ok, text }. All prompt logic lives in the app."""
    try:
        body = await request.json()
        prompt = (body or {}).get("prompt")
        if not prompt:
            raise ValueError("ต้องมี prompt")
        text = await run_in_threadpool(cli_runner.run_claude, prompt)
        return {"ok": True, "text": text}
    except Exception as e:  # noqa: BLE001 — match bridge catch-all behavior
        return err(e)


@router.post("/edit")
async def edit(request: Request):
    """Edit Flex JSON through `claude -p` — identical prompt to bridge/server.cjs."""
    try:
        body = await request.json()
        flex = (body or {}).get("flex")
        instruction = (body or {}).get("instruction")
        if not flex or not instruction:
            raise ValueError("ต้องมี flex + instruction")
        prompt = (
            "You are a LINE Flex Message design editor.\n"
            f"Here is a LINE Flex Message JSON:\n\n{flex}\n\n"
            f"Apply this instruction (Thai or English): {instruction}\n\n"
            "Return ONLY the complete updated JSON — no prose, no markdown fences. "
            "Keep it valid per LINE Flex spec and preserve every field you are not changing, "
            'especially hero image URLs and the footer button "action".'
        )
        text = await run_in_threadpool(cli_runner.run_claude, prompt)
        return {"ok": True, "text": text}
    except Exception as e:  # noqa: BLE001
        return err(e)


@router.post("/genimage")
async def genimage(request: Request):
    """Free image generation via codex (no API key). { prompt, refBase64? } -> { ok, base64, mime }"""
    ref_path = None
    try:
        body = await request.json()
        prompt = (body or {}).get("prompt")
        if not prompt:
            raise ValueError("ต้องมี prompt")
        ref_path = cli_runner.write_ref_image((body or {}).get("refBase64"))
        img = await run_in_threadpool(cli_runner.run_codex_image, prompt, ref_path)
        return {"ok": True, "base64": img["base64"], "mime": img["mime"]}
    except Exception as e:  # noqa: BLE001
        return err(e)
    finally:
        if ref_path:
            try:
                os.unlink(ref_path)
            except OSError:
                pass
