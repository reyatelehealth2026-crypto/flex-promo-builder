"""Tests for app/services/imagegen.py (port of lib/imagegen.js)."""

import json

import pytest

from app.services import imagegen


class TestBuildImageRequest:
    def test_openai_request(self):
        desc = imagegen.build_image_request("openai", "sk-x", "a cat", {"size": "1024x1536"})
        assert desc["url"] == imagegen.OPENAI_URL
        assert desc["headers"]["authorization"] == "Bearer sk-x"
        body = json.loads(desc["body"])
        assert body == {"model": "gpt-image-1", "prompt": "a cat", "size": "1024x1536", "n": 1}

    def test_openai_default_size(self):
        body = json.loads(imagegen.build_image_request("openai", "k", "p")["body"])
        assert body["size"] == "1024x1024"

    def test_gemini_request(self):
        desc = imagegen.build_image_request("gemini", "g-key", "a dog")
        assert desc["url"] == f"{imagegen.GEMINI_BASE}/{imagegen.GEMINI_MODEL}:generateContent"
        assert desc["headers"]["x-goog-api-key"] == "g-key"
        body = json.loads(desc["body"])
        assert body["contents"][0]["parts"] == [{"text": "a dog"}]
        assert body["generationConfig"]["responseModalities"] == ["TEXT", "IMAGE"]

    def test_gemini_ref_image_goes_first(self):
        desc = imagegen.build_image_request(
            "gemini", "k", "restyle this", {"refImage": {"mime": "image/jpeg", "base64": "QUJD"}}
        )
        parts = json.loads(desc["body"])["contents"][0]["parts"]
        assert parts[0] == {"inlineData": {"mimeType": "image/jpeg", "data": "QUJD"}}
        assert parts[1] == {"text": "restyle this"}

    def test_unknown_provider(self):
        with pytest.raises(ValueError, match="Unknown image provider"):
            imagegen.build_image_request("dalle", "k", "p")

    def test_missing_key_and_prompt(self):
        with pytest.raises(ValueError, match="Missing API key"):
            imagegen.build_image_request("openai", "", "p")
        with pytest.raises(ValueError, match="Missing prompt"):
            imagegen.build_image_request("openai", "k", "")


class TestParseImageResponse:
    def test_openai_ok(self):
        url = imagegen.parse_image_response("openai", {"data": [{"b64_json": "QUJD"}]})
        assert url == "data:image/png;base64,QUJD"

    def test_openai_missing_data(self):
        with pytest.raises(ValueError, match="b64_json"):
            imagegen.parse_image_response("openai", {"data": []})

    def test_error_object(self):
        with pytest.raises(ValueError, match="quota exceeded"):
            imagegen.parse_image_response("openai", {"error": {"message": "quota exceeded"}})

    def test_error_string(self):
        with pytest.raises(ValueError, match="boom"):
            imagegen.parse_image_response("gemini", {"error": "boom"})

    def test_gemini_ok(self):
        payload = {
            "candidates": [
                {"content": {"parts": [{"text": "here"}, {"inlineData": {"mimeType": "image/webp", "data": "WFla"}}]}}
            ]
        }
        assert imagegen.parse_image_response("gemini", payload) == "data:image/webp;base64,WFla"

    def test_gemini_refusal_uses_finish_reason(self):
        with pytest.raises(ValueError, match="SAFETY"):
            imagegen.parse_image_response("gemini", {"candidates": [{"finishReason": "SAFETY"}]})

    def test_gemini_text_only_uses_text(self):
        payload = {"candidates": [{"content": {"parts": [{"text": "cannot do that"}]}}]}
        with pytest.raises(ValueError, match="cannot do that"):
            imagegen.parse_image_response("gemini", payload)

    def test_empty_response(self):
        with pytest.raises(ValueError, match="Empty image response"):
            imagegen.parse_image_response("gemini", None)
