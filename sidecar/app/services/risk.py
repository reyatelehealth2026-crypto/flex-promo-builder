"""Rule-based Thai/English health-claim risk checker.

Scans ad copy for risky health claims (cure/treatment claims, disease
prevention, weight-loss guarantees, prohibited superlatives, อย./FDA misuse,
absolute-safety claims, ...) per Thai FDA (อย.) advertising rules.

The rule list lives in app/data/health_claim_rules.json so the pharmacy team
can edit vocabulary without touching code.

Matching strategy:
- Thai rules use substring matching (Thai script has no word boundaries) or
  regex for numeric/timed patterns.
- English rules use regex with word boundaries, case-insensitive.

Longer, more specific terms win: when two findings from the SAME category
overlap (e.g. 'รักษาโรค' high vs 'รักษา' medium inside it), only the longer /
higher-severity finding is kept, so generic-word rules don't double-report.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "health_claim_rules.json"

SEVERITY_ORDER = {"low": 1, "medium": 2, "high": 3}


@lru_cache(maxsize=1)
def load_rules() -> list[dict]:
    with open(DATA_PATH, encoding="utf-8") as f:
        doc = json.load(f)
    rules = doc["rules"]
    # Pre-compile regex rules once.
    for rule in rules:
        if rule.get("type") == "regex":
            rule["_compiled"] = re.compile(rule["pattern"], re.IGNORECASE)
    return rules


def _find_term(text: str, term: str) -> list[tuple[int, int]]:
    """All (start, end) occurrences of a literal term (case-insensitive)."""
    spans = []
    lowered = text.lower()
    needle = term.lower()
    start = 0
    while True:
        i = lowered.find(needle, start)
        if i < 0:
            break
        spans.append((i, i + len(term)))
        start = i + 1
    return spans


def _dedupe_overlaps(findings: list[dict]) -> list[dict]:
    """Drop a finding fully contained in another finding of the same category
    with equal/greater severity (e.g. generic 'รักษา' inside 'รักษาโรค')."""
    kept: list[dict] = []
    for f in findings:
        contained = False
        for other in findings:
            if other is f or other["category"] != f["category"]:
                continue
            inside = other["start"] <= f["start"] and f["end"] <= other["end"]
            bigger = (other["end"] - other["start"]) > (f["end"] - f["start"])
            stronger = SEVERITY_ORDER[other["severity"]] >= SEVERITY_ORDER[f["severity"]]
            if inside and bigger and stronger:
                contained = True
                break
        if not contained:
            kept.append(f)
    return kept


def check_text(text: str, langs: list[str] | None = None) -> dict[str, Any]:
    """Scan ad copy and return findings with positions + safer alternatives.

    Returns:
      {
        "risk_level": "none" | "low" | "medium" | "high",
        "counts": {"high": n, "medium": n, "low": n},
        "findings": [
          {"rule_id", "category", "severity", "term", "match",
           "start", "end", "message", "suggestion"}, ...
        ]
      }
    `term` is the rule term/pattern that fired; `match` is the actual matched
    text; `start`/`end` are character offsets into the input.
    """
    text = text or ""
    findings: list[dict] = []

    for rule in load_rules():
        if langs and rule.get("lang") not in langs:
            continue
        if rule.get("type") == "regex":
            for m in rule["_compiled"].finditer(text):
                findings.append(
                    {
                        "rule_id": rule["id"],
                        "category": rule["category"],
                        "severity": rule["severity"],
                        "term": rule["pattern"],
                        "match": m.group(0),
                        "start": m.start(),
                        "end": m.end(),
                        "message": rule["message"],
                        "suggestion": rule["suggestion"],
                    }
                )
        else:
            for term in rule.get("terms", []):
                for start, end in _find_term(text, term):
                    findings.append(
                        {
                            "rule_id": rule["id"],
                            "category": rule["category"],
                            "severity": rule["severity"],
                            "term": term,
                            "match": text[start:end],
                            "start": start,
                            "end": end,
                            "message": rule["message"],
                            "suggestion": rule["suggestion"],
                        }
                    )

    findings = _dedupe_overlaps(findings)
    findings.sort(key=lambda f: (f["start"], -SEVERITY_ORDER[f["severity"]]))

    counts = {"high": 0, "medium": 0, "low": 0}
    for f in findings:
        counts[f["severity"]] += 1
    if counts["high"]:
        level = "high"
    elif counts["medium"]:
        level = "medium"
    elif counts["low"]:
        level = "low"
    else:
        level = "none"

    return {"risk_level": level, "counts": counts, "findings": findings}


def list_rules() -> list[dict]:
    """Rules without the compiled regex objects (JSON-serializable)."""
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in load_rules()]
