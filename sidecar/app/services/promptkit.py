"""PromptKit — port of lib/promptkit.js.

Marketing-grade prompt composer for CNY Healthcare image gen. Used by both
gen modes:
  - 'product' : image-to-image from a product reference photo
  - 'bg'      : background-only scene for a promo card (empty center stage)
Hard rule: NEVER ask the AI to render Thai text / numbers — all text comes
from the HTML overlay, so every composition ends with a no-text safety tail.

The kit itself lives in app/data/promptkit.json so it can be edited without
touching code; this module loads and composes it.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "promptkit.json"

SAFETY_TAIL = "no text, no captions, no watermark"


@lru_cache(maxsize=1)
def load_kit() -> dict:
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)


def frag_of(category: str, entry_id: str | None) -> str:
    """หา frag จาก id ในหมวดที่กำหนด — ข้าม 'none' / id ที่ไม่รู้จัก / frag ว่าง."""
    if not entry_id or entry_id == "none":
        return ""
    kit = load_kit()
    entry = next((e for e in kit.get(category, []) if e["id"] == entry_id), None)
    return entry["frag"] if entry else ""


def compose_prompt(opts: dict | None = None) -> str:
    """ประกอบ prompt จากตัวเลือกใน UI.

    opts: { mode:'product'|'bg', purposeId, styleId, themeId, elementIds:[],
            moodId, productName?, extra? }
    """
    opts = opts or {}
    mode = opts.get("mode", "product")
    purpose_id = opts.get("purposeId")
    style_id = opts.get("styleId")
    theme_id = opts.get("themeId")
    element_ids = opts.get("elementIds") or []
    mood_id = opts.get("moodId")
    product_name = opts.get("productName")
    extra = opts.get("extra")

    parts: list[str] = []

    if mode == "bg":
        parts.extend(
            [
                "promotional background scene for a Thai pharmacy promo card",
                "empty center stage area reserved for product placement, no text, no letters, no numbers, no watermark",
                "decorative elements kept to the edges and corners, the center kept clear and uncluttered",
            ]
        )
    else:
        name = str(product_name).strip() if product_name else ""
        parts.extend(
            [
                "professional product photograph" + (f" of {name}" if name else ""),
                "keep the exact product from the reference photo unchanged, do not alter label or packaging",
            ]
        )

    purpose_frag = frag_of("purpose", purpose_id)
    if mode == "product" and purpose_frag:
        parts.append(purpose_frag)

    style_frag = frag_of("style", style_id)
    if style_frag:
        parts.append(style_frag)

    theme_frag = frag_of("theme", theme_id)
    if theme_frag:
        parts.append(theme_frag)

    ids = element_ids if isinstance(element_ids, list) else []
    for eid in ids:
        f = frag_of("elements", eid)
        if f:
            parts.append(f)

    mood_frag = frag_of("mood", mood_id)
    if mood_frag:
        parts.append(mood_frag)

    extra_text = extra.strip() if isinstance(extra, str) else ""
    if extra_text:
        parts.append(extra_text)

    parts.append(SAFETY_TAIL)

    return ", ".join(p for p in parts if p)


def default_selection(mode: str = "product") -> dict:
    """ค่าเริ่มต้นที่เหมาะกับแต่ละโหมด."""
    if mode == "bg":
        return {
            "mode": "bg",
            "purposeId": None,  # bg mode ไม่ใช้ purpose
            "styleId": "studio",
            "themeId": "cny_redgold",
            "elementIds": ["bokeh"],
            "moodId": "festive",
        }
    return {
        "mode": "product",
        "purposeId": "ads",
        "styleId": "studio",
        "themeId": "clean_blue",
        "elementIds": ["natural_light"],
        "moodId": "trustworthy",
    }
