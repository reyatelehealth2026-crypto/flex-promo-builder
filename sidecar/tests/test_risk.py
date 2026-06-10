"""Thorough tests for the Thai health-claim risk checker (app/services/risk.py)."""

import re

from app.services import risk


def severities(result):
    return {f["severity"] for f in result["findings"]}


def categories(result):
    return {f["category"] for f in result["findings"]}


def rule_ids(result):
    return {f["rule_id"] for f in result["findings"]}


# ---- Thai high-severity claims ----------------------------------------------

def test_cure_claim_hai_khat():
    r = risk.check_text("กินแล้วโรคเบาหวานหายขาด ไม่ต้องพึ่งยา")
    assert r["risk_level"] == "high"
    assert any(f["match"] == "หายขาด" for f in r["findings"])


def test_raksa_rok_high_and_generic_raksa_deduped():
    r = risk.check_text("สมุนไพรรักษาโรคได้ทุกชนิด")
    matches = [(f["rule_id"], f["match"]) for f in r["findings"]]
    assert ("th_cure_claim", "รักษาโรค") in matches
    # the generic medium 'รักษา' inside 'รักษาโรค' must be suppressed
    assert ("th_cure_word", "รักษา") not in matches


def test_generic_raksa_alone_is_medium():
    r = risk.check_text("ช่วยรักษาอาการปวดเมื่อย")
    assert r["risk_level"] == "medium"
    assert "th_cure_word" in rule_ids(r)


def test_disease_prevention():
    r = risk.check_text("ป้องกันมะเร็งและต้านไวรัสได้")
    assert r["risk_level"] == "high"
    assert "disease_prevention" in categories(r)


def test_disease_marker_claims():
    for text in ["ลดเบาหวาน", "ลดความดัน", "ลดคอเลสเตอรอล", "ล้างตับ", "ฟื้นฟูตับ"]:
        r = risk.check_text(f"สูตรเด็ด {text} ภายในเดือนเดียว")
        assert r["risk_level"] == "high", text


def test_weight_loss_term():
    r = risk.check_text("อาหารเสริมลดน้ำหนักสูตรใหม่")
    assert r["risk_level"] == "high"
    assert "weight_loss" in categories(r)


def test_weight_loss_number_regex():
    r = risk.check_text("ลดน้ำหนัก 10 กิโลใน 1 เดือน")
    assert "th_weight_loss_number" in rule_ids(r)
    f = next(f for f in r["findings"] if f["rule_id"] == "th_weight_loss_number")
    assert "10" in f["match"]
    # bare 'ลดน้ำหนัก' term is contained inside the regex match -> deduped
    assert not any(f["rule_id"] == "th_weight_loss" and f["match"] == "ลดน้ำหนัก" for f in r["findings"])


def test_result_guarantee_and_timeframe():
    r = risk.check_text("เห็นผล 100% การันตี เห็นผลใน 7 วัน")
    ids = rule_ids(r)
    assert "th_result_guarantee" in ids
    assert "th_result_within_days" in ids
    assert r["risk_level"] == "high"


def test_prohibited_words_per_drug_ad_law():
    for word in ["ดีที่สุด", "เด็ดขาด", "ศักดิ์สิทธิ์", "มหัศจรรย์", "หายห่วง", "วิเศษ"]:
        r = risk.check_text(f"ยาตัวนี้{word}เลยครับ")
        assert r["risk_level"] == "high", word
        assert "prohibited_word" in categories(r), word


def test_fda_misuse_thai():
    r = risk.check_text("ผลิตภัณฑ์นี้ อย. รับรองว่าได้ผลจริง")
    assert "th_fda_misuse" in rule_ids(r)
    f = next(f for f in r["findings"] if f["rule_id"] == "th_fda_misuse")
    assert "เลข" in f["suggestion"]  # safer alternative mentions the reg number


def test_safety_claim():
    r = risk.check_text("ปลอดภัย 100% ไม่มีผลข้างเคียง")
    assert r["counts"]["high"] >= 2


def test_sexual_enhancement():
    r = risk.check_text("ช่วยเพิ่มสมรรถภาพทางเพศ อึดทนนาน")
    assert r["risk_level"] == "high"
    assert "sexual_enhancement" in categories(r)


# ---- Thai medium-severity ----------------------------------------------------

def test_detox_is_medium():
    r = risk.check_text("ดีท็อกซ์ล้างลำไส้ ขับสารพิษ")
    assert r["risk_level"] == "medium"
    assert r["counts"]["high"] == 0


def test_immune_function_claim_medium():
    r = risk.check_text("ช่วยเสริมภูมิคุ้มกันให้แข็งแรง")
    assert r["risk_level"] == "medium"


def test_beauty_timed_high_vs_soft_medium():
    assert risk.check_text("ผิวขาวใน 7 วัน")["risk_level"] == "high"
    assert risk.check_text("ผิวขาวใสมีออร่า")["risk_level"] == "medium"


# ---- English ------------------------------------------------------------------

def test_english_cure_fda_safety_guarantee():
    text = "This miracle supplement cures cancer. FDA approved, no side effects, guaranteed results, 100% effective!"
    r = risk.check_text(text)
    assert r["risk_level"] == "high"
    ids = rule_ids(r)
    assert {"en_cure", "en_fda_misuse", "en_safety", "en_guarantee", "en_miracle"} <= ids


def test_english_case_insensitive():
    r = risk.check_text("CURES everything, fda-APPROVED")
    assert {"en_cure", "en_fda_misuse"} <= rule_ids(r)


def test_english_treat_is_medium_only():
    r = risk.check_text("Treat yourself to our new vitamin gummies")
    assert r["risk_level"] == "medium"
    assert all(f["severity"] != "high" for f in r["findings"])


def test_english_prevents_disease():
    r = risk.check_text("Prevents diabetes and boosts your day")
    assert "en_prevent_disease" in rule_ids(r)


def test_english_word_boundaries():
    # 'securely' contains 'cure' but must NOT fire \bcures?\b
    r = risk.check_text("Pay securely with your card")
    assert "en_cure" not in rule_ids(r)


def test_english_superlative_and_evidence_medium():
    r = risk.check_text("The best vitamin, clinically proven, doctor recommended")
    assert r["counts"]["medium"] >= 2
    assert r["counts"]["high"] == 0


# ---- positions, langs filter, clean text, structure ---------------------------

def test_positions_point_at_the_match():
    text = "โปรนี้การันตีผลลัพธ์"
    r = risk.check_text(text)
    for f in r["findings"]:
        assert text[f["start"]:f["end"]] == f["match"]


def test_every_finding_has_suggestion_and_message():
    r = risk.check_text("รักษาโรค หายขาด ลดน้ำหนัก 5 กิโล อย. รับรอง ดีที่สุด no side effects")
    assert r["findings"]
    for f in r["findings"]:
        assert f["message"].strip()
        assert f["suggestion"].strip()


def test_langs_filter():
    text = "หายขาด cures"
    th_only = risk.check_text(text, langs=["th"])
    en_only = risk.check_text(text, langs=["en"])
    assert all(f["rule_id"].startswith("th_") for f in th_only["findings"]) and th_only["findings"]
    assert all(f["rule_id"].startswith("en_") for f in en_only["findings"]) and en_only["findings"]


def test_clean_copy_passes():
    r = risk.check_text("โปรโมชั่นพิเศษ วิตามินซี 500mg ลด 50% ส่งฟรีทั่วประเทศ วันนี้ถึงสิ้นเดือน")
    assert r["risk_level"] == "none"
    assert r["findings"] == []
    assert r["counts"] == {"high": 0, "medium": 0, "low": 0}


def test_empty_text():
    assert risk.check_text("")["risk_level"] == "none"


def test_findings_sorted_by_position():
    r = risk.check_text("ดีที่สุด แล้วก็ หายขาด แถม การันตี")
    starts = [f["start"] for f in r["findings"]]
    assert starts == sorted(starts)


# ---- rules file integrity ------------------------------------------------------

def test_rules_file_integrity():
    rules = risk.list_rules()
    ids = [r["id"] for r in rules]
    assert len(ids) == len(set(ids)), "rule ids must be unique"
    for rule in rules:
        assert rule["severity"] in ("low", "medium", "high"), rule["id"]
        assert rule["lang"] in ("th", "en"), rule["id"]
        assert rule["message"].strip() and rule["suggestion"].strip(), rule["id"]
        if rule["type"] == "regex":
            re.compile(rule["pattern"])  # must compile
        else:
            assert rule["terms"], rule["id"]
        # serializable (no compiled regex leaking out of list_rules)
        assert "_compiled" not in rule
