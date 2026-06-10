"""Image generation request builders/parsers — port of lib/imagegen.js.

Providers: OpenAI (gpt-image-1) and Google Gemini (Nano Banana 2).
Pure functions: build an HTTP request descriptor, parse the provider response
into a PNG data URL. The HTTP call itself is done by the router via httpx.
API keys come from env vars or the request payload — never hardcoded.
"""

from __future__ import annotations

import json
from typing import Any

IMAGE_PROVIDERS = ["openai", "gemini"]

OPENAI_URL = "https://api.openai.com/v1/images/generations"
# Nano Banana 2 — latest Gemini image model (supersedes gemini-2.5-flash-image).
GEMINI_MODEL = "gemini-3.1-flash-image"
# Image-output models + responseModalities only exist on v1beta — the v1
# endpoint rejects the request with 400 (unknown field / model not found).
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


def build_image_request(provider: str, key: str, prompt: str, opts: dict | None = None) -> dict[str, Any]:
    """Build an HTTP request descriptor for the given image provider.

    opts: { size?: str, refImage?: {mime?: str, base64: str} }
      refImage — optional reference image for image-to-image (Gemini only).
    Returns {url, method, headers, body}.
    """
    opts = opts or {}
    if provider not in IMAGE_PROVIDERS:
        raise ValueError(f"Unknown image provider: {provider}")
    if not isinstance(key, str) or len(key) == 0:
        raise ValueError("Missing API key")
    if not isinstance(prompt, str) or len(prompt) == 0:
        raise ValueError("Missing prompt")

    if provider == "openai":
        body = {
            "model": "gpt-image-1",
            "prompt": prompt,
            "size": opts.get("size") or "1024x1024",
            "n": 1,
        }
        return {
            "url": OPENAI_URL,
            "method": "POST",
            "headers": {
                "authorization": f"Bearer {key}",
                "content-type": "application/json",
            },
            "body": json.dumps(body),
        }

    # provider == "gemini"
    # Image-to-image: a reference image is sent as an inlineData part alongside
    # the text. Gemini reads the image then applies the prompt to it.
    parts: list[dict] = []
    ref = opts.get("refImage")
    if ref and ref.get("base64"):
        parts.append(
            {
                "inlineData": {
                    "mimeType": ref.get("mime") or "image/png",
                    "data": ref["base64"],
                }
            }
        )
    parts.append({"text": prompt})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    return {
        "url": f"{GEMINI_BASE}/{GEMINI_MODEL}:generateContent",
        "method": "POST",
        "headers": {
            "x-goog-api-key": key,
            "content-type": "application/json",
        },
        "body": json.dumps(body),
    }


def parse_image_response(provider: str, payload: dict | None) -> str:
    """Parse a provider response JSON into a PNG data URL.

    Raises ValueError with the provider message on an error/refusal payload.
    Returns 'data:image/png;base64,<...>'.
    """
    if provider not in IMAGE_PROVIDERS:
        raise ValueError(f"Unknown image provider: {provider}")
    if not payload or not isinstance(payload, dict):
        raise ValueError("Empty image response")

    # Both providers surface failures under an `error` object.
    if payload.get("error"):
        err = payload["error"]
        message = (
            (isinstance(err, dict) and (err.get("message") or err.get("status")))
            or (isinstance(err, str) and err)
            or "Image generation failed"
        )
        raise ValueError(message)

    if provider == "openai":
        data = payload.get("data") or []
        item = data[0] if data else None
        b64 = item.get("b64_json") if isinstance(item, dict) else None
        if not b64:
            raise ValueError("OpenAI response missing image data (data[0].b64_json)")
        return f"data:image/png;base64,{b64}"

    # provider == "gemini"
    candidates = payload.get("candidates") or []
    candidate = candidates[0] if candidates else None
    if not candidate:
        raise ValueError("Gemini response missing candidates")
    # A refusal / safety block may set finishReason without inline image data.
    parts = ((candidate.get("content") or {}).get("parts")) or []
    inline = None
    for part in parts:
        if part and part.get("inlineData", {}).get("data"):
            inline = part["inlineData"]
            break
    if not inline:
        text_part = next((p for p in parts if p and p.get("text")), None)
        reason = (
            candidate.get("finishReason")
            or (text_part and text_part.get("text"))
            or "Gemini response missing inline image data"
        )
        raise ValueError(str(reason))
    mime = inline.get("mimeType") or "image/png"
    return f"data:{mime};base64,{inline['data']}"
