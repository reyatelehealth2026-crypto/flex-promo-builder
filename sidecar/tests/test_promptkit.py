"""Tests for app/services/promptkit.py — ported from the lib/promptkit.js self-test."""

from app.services.promptkit import SAFETY_TAIL, compose_prompt, default_selection, frag_of, load_kit


def assert_contains_all(prompt: str, fragments: list[str]):
    missing = [s for s in fragments if s not in prompt]
    assert not missing, f"missing: {' | '.join(missing)}\nprompt: {prompt}"


def test_product_ads_studio():
    p = compose_prompt(
        {
            "mode": "product",
            "purposeId": "ads",
            "styleId": "studio",
            "themeId": "none",
            "elementIds": ["none"],
            "moodId": "urgent",
            "productName": "Blackmores Fish Oil 1000mg",
        }
    )
    assert_contains_all(
        p,
        [
            "keep the exact product from the reference photo unchanged",
            "Blackmores Fish Oil 1000mg",
            "advertising hero shot",
            "studio photography",
            SAFETY_TAIL,
        ],
    )


def test_bg_cny_redgold_angpao_flowers():
    p = compose_prompt(
        {
            "mode": "bg",
            "styleId": "premium",
            "themeId": "cny_redgold",
            "elementIds": ["angpao", "flowers"],
            "moodId": "festive",
        }
    )
    assert_contains_all(
        p,
        [
            "empty center stage area reserved for product placement",
            "no letters, no numbers",
            "red and gold",
            "ang pao",
            "fresh flowers",
            SAFETY_TAIL,
        ],
    )


def test_product_drug_info_compliance_safe():
    p = compose_prompt(
        {
            "mode": "product",
            "purposeId": "drug_info",
            "styleId": "photo_real",
            "themeId": "clean_blue",
            "elementIds": ["natural_light"],
            "moodId": "trustworthy",
            "productName": "Tylenol 500",
            "extra": "shallow depth of field",
        }
    )
    assert_contains_all(
        p,
        [
            "do not alter label or packaging",
            "no medical claims text",
            "trustworthy",
            "shallow depth of field",
            SAFETY_TAIL,
        ],
    )


def test_every_prompt_ends_with_safety_tail():
    assert compose_prompt({}).endswith(SAFETY_TAIL)
    assert compose_prompt({"mode": "bg"}).endswith(SAFETY_TAIL)


def test_bg_mode_ignores_purpose():
    p = compose_prompt({"mode": "bg", "purposeId": "ads"})
    assert "advertising hero shot" not in p


def test_frag_of_handles_none_and_unknown():
    assert frag_of("style", None) == ""
    assert frag_of("style", "none") == ""
    assert frag_of("style", "does-not-exist") == ""
    assert frag_of("no-such-category", "studio") == ""


def test_default_selection():
    bg = default_selection("bg")
    assert bg["mode"] == "bg" and bg["purposeId"] is None and bg["themeId"] == "cny_redgold"
    product = default_selection("product")
    assert product["purposeId"] == "ads" and product["moodId"] == "trustworthy"


def test_kit_data_integrity():
    kit = load_kit()
    assert set(kit) == {"purpose", "style", "theme", "elements", "mood"}
    for category, entries in kit.items():
        ids = [e["id"] for e in entries]
        assert len(ids) == len(set(ids)), f"duplicate ids in {category}"
        for e in entries:
            assert "label" in e and "frag" in e
