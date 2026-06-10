"""Tests for app/services/ai.py (port of lib/ai.js)."""

import json

import pytest

from app.services import ai

FLEX = '{"type":"flex","altText":"โปร"}'

# Fake credentials for prefix-routing tests. Built by concatenation so secret
# scanners (GitGuardian) don't flag the literals as leaked Anthropic keys.
FAKE_API_KEY = "sk-ant-" + "api03-not-a-real-key"
FAKE_OAUTH_TOKEN = "sk-ant-" + "oat01-not-a-real-token"
FAKE_OAUTH_ALT = "sk-ant-" + "oauth-not-a-real-token"


class TestBuildEditPrompt:
    def test_apply_contains_persona_rules_and_payload(self):
        p = ai.build_edit_prompt(FLEX, "เปลี่ยนปุ่มเป็นสีแดง", "apply")
        assert ai.CRM_PERSONA in p
        assert ai.EDIT_RULES in p
        assert ai.STYLE_REFERENCE in p
        assert FLEX in p
        assert "เปลี่ยนปุ่มเป็นสีแดง" in p
        assert "คืนเฉพาะ flex JSON ฉบับเต็มที่แก้แล้ว" in p

    def test_advise_mode_has_advice_contract(self):
        p = ai.build_edit_prompt(FLEX, "ขอคำแนะนำ", "advise")
        assert '{"advice": ["...","..."], "flex": <flex ฉบับเต็มที่ปรับแล้ว>}' in p
        assert "ที่ปรึกษาดีไซน์" in p
        assert "คืนเฉพาะ flex JSON" not in p


class TestAuthHeaders:
    def test_api_key_uses_x_api_key(self):
        h = ai.auth_headers(FAKE_API_KEY)
        assert h["x-api-key"] == FAKE_API_KEY
        assert "authorization" not in h
        assert h["anthropic-version"] == "2023-06-01"

    def test_oauth_token_uses_bearer_plus_beta(self):
        h = ai.auth_headers(FAKE_OAUTH_TOKEN)
        assert h["authorization"] == f"Bearer {FAKE_OAUTH_TOKEN}"
        assert h["anthropic-beta"] == "oauth-2025-04-20"
        assert "x-api-key" not in h

    def test_whitespace_and_none_tolerated(self):
        assert ai.auth_headers(f"  {FAKE_OAUTH_ALT} ")["authorization"] == f"Bearer {FAKE_OAUTH_ALT}"
        assert ai.auth_headers(None)["x-api-key"] == ""


class TestRequestBuilders:
    def test_build_ai_request_shape(self):
        desc = ai.build_ai_request(FAKE_API_KEY, FLEX, "ทำให้ดูแพง", "apply")
        assert desc["url"] == ai.AI_ENDPOINT
        body = json.loads(desc["body"])
        assert body["model"] == ai.AI_MODEL == "claude-opus-4-8"
        assert body["max_tokens"] == 16000
        assert body["output_config"] == {"effort": "low"}
        assert body["messages"][0]["role"] == "user"
        assert FLEX in body["messages"][0]["content"]

    def test_build_ai_text_request(self):
        desc = ai.build_ai_text_request(FAKE_API_KEY, "เขียนแคปชั่น", max_tokens=1234)
        body = json.loads(desc["body"])
        assert body["max_tokens"] == 1234
        assert body["messages"] == [{"role": "user", "content": "เขียนแคปชั่น"}]

    def test_build_test_request_minimal(self):
        body = json.loads(ai.build_test_request(FAKE_API_KEY)["body"])
        assert body["max_tokens"] == 1


class TestExtractJson:
    def test_strips_code_fences(self):
        assert ai.extract_json('```json\n{"a":1}\n```') == '{"a":1}'

    def test_slices_object_out_of_prose(self):
        assert ai.extract_json('here you go: {"a": {"b": 2}} hope it helps') == '{"a": {"b": 2}}'

    def test_array_top_level(self):
        assert ai.extract_json("[1,2,3] trailing") == "[1,2,3]"

    def test_no_brackets_returns_input(self):
        assert ai.extract_json("plain text") == "plain text"


class TestParseEditResponse:
    def test_apply_parses_flex(self):
        out = ai.parse_edit_response('```json\n{"type":"flex"}\n```', "apply")
        assert out == {"type": "flex"}

    def test_apply_invalid_raises(self):
        with pytest.raises(json.JSONDecodeError):
            ai.parse_edit_response("ขอโทษ ทำไม่ได้", "apply")

    def test_advise_plain_text_becomes_advice(self):
        out = ai.parse_edit_response("เน้นราคาถูก หรือเน้นความน่าเชื่อถือ?", "advise")
        assert out == {"advice": ["เน้นราคาถูก หรือเน้นความน่าเชื่อถือ?"], "flex": None}

    def test_advise_empty_text(self):
        assert ai.parse_edit_response("", "advise") == {"advice": [], "flex": None}

    def test_advise_structured(self):
        out = ai.parse_edit_response('{"advice":["ใช้สีแดง"],"flex":{"type":"flex"}}', "advise")
        assert out["advice"] == ["ใช้สีแดง"]
        assert out["flex"] == {"type": "flex"}

    def test_advise_bare_flex(self):
        out = ai.parse_edit_response('{"type":"flex","altText":"x"}', "advise")
        assert out == {"advice": [], "flex": {"type": "flex", "altText": "x"}}


class TestResponseParsers:
    def test_text_from_response(self):
        resp = {"content": [{"type": "text", "text": "A"}, {"type": "tool_use"}, {"type": "text", "text": "B"}]}
        assert ai.text_from_response(resp) == "AB"

    def test_text_from_response_error_raises(self):
        with pytest.raises(ValueError, match="overloaded"):
            ai.text_from_response({"type": "error", "error": {"message": "overloaded"}})

    def test_parse_flex_from_response(self):
        resp = {"content": [{"type": "text", "text": '```json\n{"type":"flex"}\n```'}]}
        assert ai.parse_flex_from_response(resp) == {"type": "flex"}

    def test_parse_flex_from_text_empty_raises(self):
        with pytest.raises(ValueError):
            ai.parse_flex_from_text("   ")
