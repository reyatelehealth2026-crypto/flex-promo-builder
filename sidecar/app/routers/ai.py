"""AI content endpoints — the lib/ai.js port exposed over HTTP.

POST /ai/edit     — edit Flex JSON with the crm-marketer persona prompt
                    (modes: apply | advise; backends: cli | api)
POST /ai/generate — generic text generation with a caller-supplied prompt

Backends:
  cli — `claude -p` via the user's Claude Code login (no API key; default)
  api — Anthropic Messages API. The key comes from the request `apiKey`
        field or the ANTHROPIC_API_KEY env var. Never hardcoded.
"""

from __future__ import annotations

import json
import os

import httpx
from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..services import ai as ai_service
from ..services import cli_runner
from .common import err

router = APIRouter(prefix="/ai", tags=["ai"])

API_TIMEOUT_S = 300


async def _call_anthropic(request_desc: dict) -> dict:
    async with httpx.AsyncClient(timeout=API_TIMEOUT_S) as client:
        resp = await client.post(
            request_desc["url"],
            headers=request_desc["headers"],
            content=request_desc["body"],
        )
        return resp.json()


def _resolve_api_key(body: dict) -> str:
    key = (body.get("apiKey") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        raise ValueError("ไม่มี API key — ส่ง apiKey มาใน request หรือตั้ง ANTHROPIC_API_KEY")
    return key


@router.post("/edit")
async def ai_edit(request: Request):
    """{ flex, instruction, mode?, backend?, apiKey? } ->
    mode 'apply':  { ok, flex }
    mode 'advise': { ok, advice: [..], flex: <obj|null> }"""
    try:
        body = await request.json() or {}
        flex = body.get("flex")
        instruction = body.get("instruction")
        if not flex or not instruction:
            raise ValueError("ต้องมี flex + instruction")
        mode = body.get("mode") or "apply"
        if mode not in ("apply", "advise"):
            raise ValueError(f"mode ไม่ถูกต้อง: {mode}")
        backend = body.get("backend") or "cli"
        flex_json = flex if isinstance(flex, str) else json.dumps(flex, ensure_ascii=False)

        if backend == "api":
            key = _resolve_api_key(body)
            desc = ai_service.build_ai_request(key, flex_json, instruction, mode)
            api_response = await _call_anthropic(desc)
            text = ai_service.text_from_response(api_response)
        else:
            prompt = ai_service.build_edit_prompt(flex_json, instruction, mode)
            text = await run_in_threadpool(cli_runner.run_claude, prompt)

        parsed = ai_service.parse_edit_response(text, mode)
        if mode == "advise":
            return {"ok": True, "advice": parsed["advice"], "flex": parsed["flex"]}
        return {"ok": True, "flex": parsed}
    except Exception as e:  # noqa: BLE001
        return err(e)


@router.post("/generate")
async def ai_generate(request: Request):
    """{ prompt, maxTokens?, backend?, apiKey? } -> { ok, text }"""
    try:
        body = await request.json() or {}
        prompt = body.get("prompt")
        if not prompt:
            raise ValueError("ต้องมี prompt")
        backend = body.get("backend") or "cli"

        if backend == "api":
            key = _resolve_api_key(body)
            desc = ai_service.build_ai_text_request(key, prompt, int(body.get("maxTokens") or 4000))
            api_response = await _call_anthropic(desc)
            text = ai_service.text_from_response(api_response)
        else:
            text = await run_in_threadpool(cli_runner.run_claude, prompt)
        return {"ok": True, "text": text}
    except Exception as e:  # noqa: BLE001
        return err(e)
