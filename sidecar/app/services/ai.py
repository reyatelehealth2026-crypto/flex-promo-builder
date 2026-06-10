"""AI design assistant — port of lib/ai.js.

Builds Anthropic Messages API requests for editing LINE Flex JSON and for
content generation, and parses the responses. Pure request-descriptor
functions (no I/O) so they are unit-testable; the actual HTTP call happens in
the router layer via httpx.

API keys are NEVER hardcoded — they come from env vars (ANTHROPIC_API_KEY)
or per-request payloads supplied by the caller.
"""

from __future__ import annotations

import json
import re
from typing import Any

AI_MODEL = "claude-opus-4-8"
AI_ENDPOINT = "https://api.anthropic.com/v1/messages"

# crm-marketer persona — Thai pharmacy sales/content expert. Used for editing
# flex (advise mode) and for content generation.
CRM_PERSONA = (
    'You are the CRM Marketer for "Re-ya", a Thai pharmacy CRM / LINE marketing platform. '
    "You are an expert in Thai pharmacy sales copywriting and LINE Flex promo design. "
    "Tone: trustworthy, friendly, sales-savvy (โทนร้านยาไทย เป็นกันเอง น่าเชื่อถือ). "
    "HARD RULE: never claim drug efficacy, disease cure, or exaggerated medical benefits "
    "(ผิดกฎหมายโฆษณายา อย.) — sell on price, promo, value, and convenience only."
)

EDIT_RULES = (
    "Keep the result valid per the LINE Flex Message spec. Preserve every field you are not "
    'changing — especially hero image URLs and the footer button "action". Keep the SAME '
    'top-level shape (a single {"type":"flex",...} object, or an array of them). Colors are '
    "hex (#RRGGBB): แดง=#E8000D เขียว=#27AE60 น้ำเงิน=#1F6FEB ม่วง=#8E44AD ส้ม=#E67E22 "
    "เทา=#999999 ดำ=#222222 ขาว=#FFFFFF. Text sizes: xs sm md lg xl xxl "
    '("ใหญ่ขึ้น" = bump up a step or two).'
)

# Reference style examples so the AI knows what the user means when they refer
# to a shop style ("แบบการ์ดโปร", "SPECIAL PROMO", "เหลือง-แดง").
STYLE_REFERENCE = (
    "สไตล์อ้างอิงของร้าน (ถ้าผู้ใช้พูดถึงสไตล์เหล่านี้ ให้ทำตามสูตรนี้):\n"
    '• "SPECIAL PROMO" / "การ์ดโปรร้าน" / "เหลือง-แดง": bubble พื้นหลังทอง #FFC400; '
    'ป้ายแดง #E2001A อักษรเหลือง "SPECIAL PROMO" มุมซ้ายบน; พาเนลขาวมน ใส่ชื่อสินค้า(ดำ หนา) '
    '+ รูปสินค้า(aspectMode fit) + ป้ายแดงเล็ก "รหัส XXXX" ชิดขวา; แถวล่าง "จำนวนจำกัด"(แดง หนา) '
    'คู่กับกล่องราคา พื้นขาว ขอบแดง 2px มน เขียน "[หน่วย]ละ"(เล็ก) + ราคาแดงตัวใหญ่ "NNN.-"; '
    'ป้ายเขียว #1B8A3A "ส่งฟรี" กลาง; ปุ่มล่างสีแดง. โชว์เฉพาะราคาพิเศษ ไม่ต้องมีราคาขีดฆ่า.\n'
    '• "classic" / "แบบเดิม": hero รูปเต็มด้านบน + ป้ายสีตาม preset + ชื่อแดง + '
    "ราคาปกติขีดฆ่า/ราคาลด/ประหยัด + ปุ่ม.\n"
    "สี hex มาตรฐาน: ทอง #FFC400 · แดงโปร #E2001A · เขียวส่งฟรี #1B8A3A · ดำ #1A1A1A. "
    "ถ้าผู้ใช้ไม่ได้ระบุสไตล์ ให้คงสไตล์เดิมของ JSON ไว้."
)


def build_edit_prompt(flex_json: str, instruction: str, mode: str = "apply") -> str:
    """Single combined prompt for editing flex.

    mode 'apply'  -> return ONLY the edited flex JSON
    mode 'advise' -> converse first (Thai); only return JSON { advice, flex }
                     when the user clearly confirms a direction
    """
    head = (
        f"{CRM_PERSONA}\n\nคุณกำลังช่วยแก้ดีไซน์ LINE Flex โปรโมชั่นร้านยา\n{EDIT_RULES}\n\n"
        f"{STYLE_REFERENCE}\n\n"
        f"Flex JSON ปัจจุบัน:\n```json\n{flex_json}\n```\n\n"
        f"สิ่งที่ผู้ใช้ต้องการ: {instruction}\n\n"
    )
    if mode == "advise":
        return head + (
            "คุณคือที่ปรึกษาดีไซน์ — คุยให้ชัดก่อน ค่อยลงมือ ตอบเป็นภาษาไทยเสมอ:\n"
            "1) ถ้าข้อความของผู้ใช้ยังไม่ได้ยืนยันทิศทางชัดเจน ห้ามส่ง JSON เด็ดขาด ให้เลือกอย่างใดอย่างหนึ่ง:\n"
            "   • ถามคำถามคม ๆ 1-2 ข้อที่ชี้ขาดดีไซน์ (เช่น เน้นราคาถูก หรือเน้นความน่าเชื่อถือ? กลุ่มลูกค้าคือใคร?)\n"
            "   • หรือเสนอแนวทางดีไซน์ 2-3 แบบที่จับต้องได้ พร้อมข้อดี-ข้อเสียสั้น ๆ ของแต่ละแบบ ให้ผู้ใช้เลือก\n"
            "   ตอบเป็นข้อความล้วนเท่านั้น ห้ามมี JSON หรือ code block ใด ๆ ปนมา\n"
            '2) ส่ง JSON ก็ต่อเมื่อข้อความของผู้ใช้ยืนยันทิศทางชัดเจนแล้วเท่านั้น (เช่นขึ้นต้นว่า "เอาแบบ", "ตกลง", "ใช้", "เอาเลย", "จัดมา")\n'
            "   เมื่อยืนยันแล้ว คืนผลเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:\n"
            '{"advice": ["...","..."], "flex": <flex ฉบับเต็มที่ปรับแล้ว>}'
        )
    return head + "คืนเฉพาะ flex JSON ฉบับเต็มที่แก้แล้ว ห้ามมีคำอธิบายหรือ markdown"


def auth_headers(key: str | None) -> dict[str, str]:
    """Pick the right auth header based on the credential type.

    - API key   (sk-ant-api...)  -> x-api-key
    - OAuth tok (sk-ant-oat...)  -> Authorization: Bearer + oauth beta header
    (sending both x-api-key and Authorization makes the API 401, so use one.)
    """
    k = (key or "").strip()
    base = {
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
    }
    if re.match(r"^sk-ant-oat", k, re.IGNORECASE) or re.match(r"^sk-ant-oauth", k, re.IGNORECASE):
        return {**base, "authorization": f"Bearer {k}", "anthropic-beta": "oauth-2025-04-20"}
    return {**base, "x-api-key": k}


def build_test_request(key: str) -> dict[str, Any]:
    """Verify the credential against the REAL endpoint (/v1/messages, max_tokens 1).

    GET /v1/models is not enough: OAuth tokens pass /v1/models but are rejected
    on /v1/messages, so only this catches that case.
    """
    return {
        "url": AI_ENDPOINT,
        "method": "POST",
        "headers": {**auth_headers(key), "content-type": "application/json"},
        "body": json.dumps(
            {"model": AI_MODEL, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]}
        ),
    }


def build_ai_request(api_key: str, flex_json: str, instruction: str, mode: str = "apply") -> dict[str, Any]:
    """Anthropic API request to edit flex. mode 'apply' | 'advise'."""
    return {
        "url": AI_ENDPOINT,
        "method": "POST",
        "headers": {**auth_headers(api_key), "content-type": "application/json"},
        "body": json.dumps(
            {
                "model": AI_MODEL,
                "max_tokens": 16000,
                "output_config": {"effort": "low"},
                "messages": [
                    {"role": "user", "content": build_edit_prompt(flex_json, instruction, mode)}
                ],
            }
        ),
    }


def build_ai_text_request(key: str, prompt: str, max_tokens: int = 4000) -> dict[str, Any]:
    """Generic Anthropic API text call (for content generation, etc.)."""
    return {
        "url": AI_ENDPOINT,
        "method": "POST",
        "headers": {**auth_headers(key), "content-type": "application/json"},
        "body": json.dumps(
            {
                "model": AI_MODEL,
                "max_tokens": max_tokens,
                "output_config": {"effort": "low"},
                "messages": [{"role": "user", "content": prompt}],
            }
        ),
    }


def text_from_response(api_response: dict | None) -> str:
    """Extract the plain text out of a /v1/messages response."""
    if api_response and api_response.get("type") == "error":
        raise ValueError((api_response.get("error") or {}).get("message") or "API error")
    blocks = (api_response or {}).get("content") or []
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()


def parse_edit_response(text: str, mode: str = "apply") -> Any:
    """Parse an edit response from raw text.

    mode 'apply'  -> flex object/array
    mode 'advise' -> { advice: [str], flex: object|None }
                     (a plain-text reply — the AI conversing/asking questions —
                      comes back as { advice:[text], flex:None }, no raise)
    """
    try:
        obj = json.loads(extract_json(text))
    except (json.JSONDecodeError, TypeError):
        if mode == "advise":
            advice = str(text or "").strip()
            return {"advice": [advice] if advice else [], "flex": None}
        raise
    if mode == "advise":
        if isinstance(obj, dict) and ("advice" in obj or "flex" in obj):
            advice = obj.get("advice")
            return {
                "advice": advice if isinstance(advice, list) else [],
                "flex": obj.get("flex"),
            }
        return {"advice": [], "flex": obj}  # model returned bare flex
    return obj


def parse_flex_from_response(api_response: dict | None) -> Any:
    """Pull the edited Flex JSON out of a /v1/messages response object."""
    if api_response and api_response.get("type") == "error":
        raise ValueError((api_response.get("error") or {}).get("message") or "API error")
    blocks = (api_response or {}).get("content") or []
    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    return parse_flex_from_text(text)


def parse_flex_from_text(text: str) -> Any:
    """Parse edited Flex JSON out of raw model/CLI text output."""
    if not text or not text.strip():
        raise ValueError("ไม่มีข้อความตอบกลับ")
    return json.loads(extract_json(text))


def extract_json(text: str) -> str:
    """Tolerant extraction: strip code fences, then slice from the first opening
    bracket to the last matching closing bracket."""
    s = (text or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s, flags=re.IGNORECASE).strip()
    first_obj = s.find("{")
    first_arr = s.find("[")
    candidates = [i for i in (first_obj, first_arr) if i >= 0]
    if not candidates:
        return s
    start = min(candidates)
    open_ch = s[start]
    close_ch = "}" if open_ch == "{" else "]"
    end = s.rfind(close_ch)
    return s[start : end + 1] if end > start else s[start:]
