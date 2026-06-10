"""Prompt kit REST endpoints (lib/promptkit.js port) so a UI can consume it.

GET  /promptkit/kits             — the full kit (purpose/style/theme/elements/mood)
GET  /promptkit/kits/{category}  — one category
GET  /promptkit/defaults?mode=   — default selection for 'product' | 'bg'
POST /promptkit/compose          — render a prompt from a selection
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..services import promptkit as kit_service
from .common import err

router = APIRouter(prefix="/promptkit", tags=["promptkit"])


@router.get("/kits")
async def kits() -> dict:
    return {"ok": True, "kit": kit_service.load_kit(), "safetyTail": kit_service.SAFETY_TAIL}


@router.get("/kits/{category}")
async def kit_category(category: str):
    kit = kit_service.load_kit()
    if category not in kit:
        return err(f"ไม่มีหมวด: {category} (มี: {', '.join(kit)})", status=404)
    return {"ok": True, "category": category, "entries": kit[category]}


@router.get("/defaults")
async def defaults(mode: str = "product"):
    if mode not in ("product", "bg"):
        return err(f"mode ไม่ถูกต้อง: {mode} (product | bg)", status=400)
    return {"ok": True, "selection": kit_service.default_selection(mode)}


@router.post("/compose")
async def compose(request: Request):
    """{ mode?, purposeId?, styleId?, themeId?, elementIds?, moodId?, productName?, extra? }
    -> { ok, prompt }"""
    try:
        body = await request.json() or {}
        mode = body.get("mode", "product")
        if mode not in ("product", "bg"):
            raise ValueError(f"mode ไม่ถูกต้อง: {mode} (product | bg)")
        prompt = kit_service.compose_prompt(body)
        return {"ok": True, "prompt": prompt}
    except Exception as e:  # noqa: BLE001
        return err(e)
