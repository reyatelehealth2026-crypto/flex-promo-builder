"""Image endpoints: provider generation, background cutout, batch multi-size export.

POST /images/generate — OpenAI gpt-image-1 / Gemini image gen (lib/imagegen.js port)
POST /images/cutout   — white-background removal (lib/cutout.js port)
POST /images/export   — one source image -> 1080x1080 / 1080x1350 / 1080x1920 / 1040x1040

Provider API keys come from the request (`apiKey`) or env vars
(OPENAI_API_KEY / GEMINI_API_KEY) — never hardcoded.
"""

from __future__ import annotations

import base64
import os

import httpx
from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..services import cutout as cutout_service
from ..services import export as export_service
from ..services import imagegen
from .common import err

router = APIRouter(prefix="/images", tags=["images"])

PROVIDER_KEY_ENV = {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}
GEN_TIMEOUT_S = 300


def _strip_data_url(b64: str) -> str:
    """Accept both bare base64 and data: URLs."""
    if b64.startswith("data:"):
        _, _, rest = b64.partition(",")
        return rest
    return b64


@router.post("/generate")
async def generate(request: Request):
    """{ provider, prompt, size?, refImage?: {mime?, base64}, apiKey? }
    -> { ok, dataUrl, mime, base64 }"""
    try:
        body = await request.json() or {}
        provider = body.get("provider") or "gemini"
        prompt = body.get("prompt")
        if not prompt:
            raise ValueError("ต้องมี prompt")
        key = (body.get("apiKey") or os.environ.get(PROVIDER_KEY_ENV.get(provider, ""), "")).strip()
        if not key:
            raise ValueError(
                f"ไม่มี API key ของ {provider} — ส่ง apiKey มาใน request หรือตั้ง "
                f"{PROVIDER_KEY_ENV.get(provider, 'env var')}"
            )
        opts = {}
        if body.get("size"):
            opts["size"] = body["size"]
        if body.get("refImage"):
            opts["refImage"] = body["refImage"]
        desc = imagegen.build_image_request(provider, key, prompt, opts)

        async with httpx.AsyncClient(timeout=GEN_TIMEOUT_S) as client:
            resp = await client.post(desc["url"], headers=desc["headers"], content=desc["body"])
            payload = resp.json()

        data_url = imagegen.parse_image_response(provider, payload)
        mime, _, b64 = data_url.removeprefix("data:").partition(";base64,")
        return {"ok": True, "dataUrl": data_url, "mime": mime, "base64": b64}
    except Exception as e:  # noqa: BLE001
        return err(e)


@router.post("/cutout")
async def cutout(request: Request):
    """{ base64, threshold?, feather?, auto? } -> { ok, base64, mime, applied }

    auto=true: only cut out when the edges are mostly white (product shots)."""
    try:
        body = await request.json() or {}
        b64 = body.get("base64")
        if not b64:
            raise ValueError("ต้องมี base64 (รูปภาพ)")
        png = base64.b64decode(_strip_data_url(b64))
        out_bytes, applied = await run_in_threadpool(
            cutout_service.cutout_png_bytes,
            png,
            int(body.get("threshold") or 236),
            int(body.get("feather") if body.get("feather") is not None else 2),
            bool(body.get("auto")),
        )
        return {
            "ok": True,
            "base64": base64.b64encode(out_bytes).decode("ascii"),
            "mime": "image/png",
            "applied": applied,
        }
    except Exception as e:  # noqa: BLE001
        return err(e)


@router.post("/export")
async def export(request: Request):
    """{ base64, sizes?: [[w,h],...], format?: 'png'|'jpeg'|'webp', quality? }
    -> { ok, images: [{width, height, mime, base64}, ...] }

    Default sizes: 1080x1080, 1080x1350, 1080x1920, 1040x1040 (cover-crop centered)."""
    try:
        body = await request.json() or {}
        b64 = body.get("base64")
        if not b64:
            raise ValueError("ต้องมี base64 (รูปภาพต้นทาง)")
        src = base64.b64decode(_strip_data_url(b64))
        sizes = body.get("sizes")
        if sizes is not None:
            sizes = [(int(s[0]), int(s[1])) for s in sizes]
        images = await run_in_threadpool(
            export_service.export_sizes,
            src,
            sizes,
            body.get("format") or "png",
            int(body.get("quality") or 90),
        )
        return {"ok": True, "images": images}
    except Exception as e:  # noqa: BLE001
        return err(e)
