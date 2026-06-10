"""Thai health-claim risk checker endpoints.

POST /risk/check — scan Thai/English ad copy for risky health claims
GET  /risk/rules — the editable rule list (app/data/health_claim_rules.json)
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..services import risk as risk_service
from .common import err

router = APIRouter(prefix="/risk", tags=["risk"])


@router.post("/check")
async def check(request: Request):
    """{ text, langs?: ['th','en'] } ->
    { ok, risk_level, counts, findings: [{rule_id, category, severity, term,
      match, start, end, message, suggestion}] }"""
    try:
        body = await request.json() or {}
        text = body.get("text")
        if text is None:
            raise ValueError("ต้องมี text")
        result = risk_service.check_text(str(text), body.get("langs"))
        return {"ok": True, **result}
    except Exception as e:  # noqa: BLE001
        return err(e)


@router.get("/rules")
async def rules() -> dict:
    return {"ok": True, "rules": risk_service.list_rules()}
