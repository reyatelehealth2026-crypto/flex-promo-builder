"""Endpoint contract tests (FastAPI TestClient). External AI/image calls and
CLI subprocesses are mocked; Pillow endpoints run for real."""

import base64
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from app.routers import ai as ai_router
from app.routers import images as images_router
from app.services import cli_runner


def png_b64(size=(64, 64), color=(255, 255, 255, 255)) -> str:
    img = Image.new("RGBA", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---- bridge-compat endpoints ---------------------------------------------------

def test_ping(client):
    r = client.get("/ping")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["service"] == "flex-bridge"  # compat with bridge/server.cjs


def test_run_success(client, monkeypatch):
    captured = {}

    def fake_run_claude(prompt):
        captured["prompt"] = prompt
        return "model says hi"

    monkeypatch.setattr(cli_runner, "run_claude", fake_run_claude)
    r = client.post("/run", json={"prompt": "hello"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "text": "model says hi"}
    assert captured["prompt"] == "hello"


def test_run_missing_prompt_matches_bridge_error(client):
    r = client.post("/run", json={})
    assert r.status_code == 500
    assert r.json() == {"ok": False, "error": "ต้องมี prompt"}


def test_edit_builds_bridge_prompt(client, monkeypatch):
    captured = {}
    monkeypatch.setattr(cli_runner, "run_claude", lambda p: captured.setdefault("prompt", p) and "" or '{"done":1}')
    r = client.post("/edit", json={"flex": '{"type":"flex"}', "instruction": "ปุ่มแดง"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    p = captured["prompt"]
    assert "You are a LINE Flex Message design editor." in p
    assert '{"type":"flex"}' in p
    assert "ปุ่มแดง" in p
    assert 'hero image URLs and the footer button "action"' in p


def test_edit_missing_fields(client):
    r = client.post("/edit", json={"flex": "{}"})
    assert r.status_code == 500
    assert r.json()["error"] == "ต้องมี flex + instruction"


def test_genimage_success(client, monkeypatch):
    monkeypatch.setattr(
        cli_runner, "run_codex_image", lambda prompt, ref_path=None: {"base64": "QUJD", "mime": "image/png"}
    )
    r = client.post("/genimage", json={"prompt": "a red pill bottle"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "base64": "QUJD", "mime": "image/png"}


def test_genimage_cli_failure_returns_500(client, monkeypatch):
    def boom(prompt, ref_path=None):
        raise cli_runner.CliError("codex ไม่ได้สร้างรูป (เช็ค codex login / โควต้า)")

    monkeypatch.setattr(cli_runner, "run_codex_image", boom)
    r = client.post("/genimage", json={"prompt": "x"})
    assert r.status_code == 500
    assert "codex" in r.json()["error"]


# ---- /ai endpoints --------------------------------------------------------------

def test_ai_edit_cli_apply(client, monkeypatch):
    monkeypatch.setattr(cli_runner, "run_claude", lambda p: '```json\n{"type":"flex","altText":"new"}\n```')
    r = client.post("/ai/edit", json={"flex": {"type": "flex"}, "instruction": "ทำใหม่"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "flex": {"type": "flex", "altText": "new"}}


def test_ai_edit_advise_plain_text(client, monkeypatch):
    monkeypatch.setattr(cli_runner, "run_claude", lambda p: "เน้นราคาหรือเน้นความน่าเชื่อถือดีครับ?")
    r = client.post("/ai/edit", json={"flex": "{}", "instruction": "ช่วยแนะนำ", "mode": "advise"})
    body = r.json()
    assert body["ok"] is True
    assert body["advice"] == ["เน้นราคาหรือเน้นความน่าเชื่อถือดีครับ?"]
    assert body["flex"] is None


def test_ai_edit_api_backend(client, monkeypatch):
    captured = {}

    async def fake_call(desc):
        captured["desc"] = desc
        return {"content": [{"type": "text", "text": '{"type":"flex","edited":true}'}]}

    monkeypatch.setattr(ai_router, "_call_anthropic", fake_call)
    r = client.post(
        "/ai/edit",
        json={"flex": "{}", "instruction": "x", "backend": "api", "apiKey": "sk-ant-api03-test"},
    )
    assert r.json() == {"ok": True, "flex": {"type": "flex", "edited": True}}
    sent = json.loads(captured["desc"]["body"])
    assert sent["model"] == "claude-opus-4-8"
    assert captured["desc"]["headers"]["x-api-key"] == "sk-ant-api03-test"


def test_ai_edit_api_backend_without_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/ai/edit", json={"flex": "{}", "instruction": "x", "backend": "api"})
    assert r.status_code == 500
    assert "API key" in r.json()["error"]


def test_ai_edit_invalid_mode(client):
    r = client.post("/ai/edit", json={"flex": "{}", "instruction": "x", "mode": "yolo"})
    assert r.status_code == 500


def test_ai_generate_cli(client, monkeypatch):
    monkeypatch.setattr(cli_runner, "run_claude", lambda p: "แคปชั่นเด็ด ๆ")
    r = client.post("/ai/generate", json={"prompt": "เขียนแคปชั่น"})
    assert r.json() == {"ok": True, "text": "แคปชั่นเด็ด ๆ"}


# ---- /images endpoints -----------------------------------------------------------

def _fake_httpx(payload, captured):
    class FakeResponse:
        def json(self):
            return payload

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, content=None):
            captured.update({"url": url, "headers": headers, "content": content})
            return FakeResponse()

    return SimpleNamespace(AsyncClient=FakeClient)


def test_images_generate_openai(client, monkeypatch):
    captured = {}
    monkeypatch.setattr(images_router, "httpx", _fake_httpx({"data": [{"b64_json": "QUJD"}]}, captured))
    r = client.post(
        "/images/generate",
        json={"provider": "openai", "prompt": "a pharmacy shelf", "apiKey": "sk-test"},
    )
    body = r.json()
    assert body["ok"] is True
    assert body["dataUrl"] == "data:image/png;base64,QUJD"
    assert body["mime"] == "image/png" and body["base64"] == "QUJD"
    assert captured["url"].startswith("https://api.openai.com/")
    assert captured["headers"]["authorization"] == "Bearer sk-test"


def test_images_generate_missing_key(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = client.post("/images/generate", json={"provider": "gemini", "prompt": "x"})
    assert r.status_code == 500
    assert "API key" in r.json()["error"]


def test_images_generate_provider_error(client, monkeypatch):
    monkeypatch.setattr(images_router, "httpx", _fake_httpx({"error": {"message": "billing hard limit"}}, {}))
    r = client.post("/images/generate", json={"provider": "openai", "prompt": "x", "apiKey": "k"})
    assert r.status_code == 500
    assert "billing hard limit" in r.json()["error"]


def test_images_cutout_endpoint(client):
    # white canvas with a red square in the middle
    img = Image.new("RGBA", (40, 40), (255, 255, 255, 255))
    for y in range(12, 28):
        for x in range(12, 28):
            img.putpixel((x, y), (200, 20, 20, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    r = client.post("/images/cutout", json={"base64": b64})
    body = r.json()
    assert body["ok"] is True and body["applied"] is True and body["mime"] == "image/png"
    out = Image.open(io.BytesIO(base64.b64decode(body["base64"]))).convert("RGBA")
    assert out.getpixel((0, 0))[3] == 0
    assert out.getpixel((20, 20))[3] == 255


def test_images_cutout_accepts_data_url_and_auto(client):
    dark = png_b64(color=(10, 10, 10, 255))
    r = client.post("/images/cutout", json={"base64": f"data:image/png;base64,{dark}", "auto": True})
    body = r.json()
    assert body["ok"] is True and body["applied"] is False


def test_images_export_default_sizes(client):
    r = client.post("/images/export", json={"base64": png_b64((500, 500))})
    body = r.json()
    assert body["ok"] is True
    dims = [(i["width"], i["height"]) for i in body["images"]]
    assert dims == [(1080, 1080), (1080, 1350), (1080, 1920), (1040, 1040)]
    first = Image.open(io.BytesIO(base64.b64decode(body["images"][0]["base64"])))
    assert first.size == (1080, 1080)


def test_images_export_custom_sizes_jpeg(client):
    r = client.post(
        "/images/export",
        json={"base64": png_b64((300, 300)), "sizes": [[200, 100]], "format": "jpeg", "quality": 80},
    )
    body = r.json()
    assert body["images"][0]["mime"] == "image/jpeg"
    assert (body["images"][0]["width"], body["images"][0]["height"]) == (200, 100)


def test_images_export_missing_base64(client):
    r = client.post("/images/export", json={})
    assert r.status_code == 500


# ---- /promptkit endpoints ---------------------------------------------------------

def test_promptkit_kits(client):
    body = client.get("/promptkit/kits").json()
    assert body["ok"] is True
    assert set(body["kit"]) == {"purpose", "style", "theme", "elements", "mood"}
    assert body["safetyTail"] == "no text, no captions, no watermark"


def test_promptkit_category(client):
    body = client.get("/promptkit/kits/style").json()
    assert body["ok"] is True
    assert any(e["id"] == "studio" for e in body["entries"])


def test_promptkit_category_404(client):
    r = client.get("/promptkit/kits/nope")
    assert r.status_code == 404
    assert r.json()["ok"] is False


def test_promptkit_defaults(client):
    body = client.get("/promptkit/defaults", params={"mode": "bg"}).json()
    assert body["selection"]["themeId"] == "cny_redgold"
    assert client.get("/promptkit/defaults", params={"mode": "x"}).status_code == 400


def test_promptkit_compose(client):
    r = client.post(
        "/promptkit/compose",
        json={"mode": "product", "purposeId": "ads", "styleId": "studio", "productName": "Vitamin C"},
    )
    body = r.json()
    assert body["ok"] is True
    assert "Vitamin C" in body["prompt"]
    assert body["prompt"].endswith("no text, no captions, no watermark")


def test_promptkit_compose_bad_mode(client):
    assert client.post("/promptkit/compose", json={"mode": "zzz"}).status_code == 500


# ---- /risk endpoints ---------------------------------------------------------------

def test_risk_check_endpoint(client):
    r = client.post("/risk/check", json={"text": "หายขาด การันตี ดีที่สุด"})
    body = r.json()
    assert body["ok"] is True
    assert body["risk_level"] == "high"
    assert body["counts"]["high"] >= 3
    f = body["findings"][0]
    assert {"rule_id", "category", "severity", "term", "match", "start", "end", "message", "suggestion"} <= set(f)


def test_risk_check_clean(client):
    body = client.post("/risk/check", json={"text": "ส่งฟรี ลด 20%"}).json()
    assert body["risk_level"] == "none" and body["findings"] == []


def test_risk_check_missing_text(client):
    r = client.post("/risk/check", json={})
    assert r.status_code == 500
    assert r.json()["error"] == "ต้องมี text"


def test_risk_check_langs_filter(client):
    body = client.post("/risk/check", json={"text": "หายขาด cures", "langs": ["en"]}).json()
    assert all(f["rule_id"].startswith("en_") for f in body["findings"])


def test_risk_rules_endpoint(client):
    body = client.get("/risk/rules").json()
    assert body["ok"] is True
    assert len(body["rules"]) >= 20
    assert all("suggestion" in r for r in body["rules"])


# ---- CORS (extension compatibility) -------------------------------------------------

def test_cors_preflight(client):
    r = client.options(
        "/run",
        headers={
            "Origin": "chrome-extension://abc",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"
