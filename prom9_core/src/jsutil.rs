//! JavaScript-semantics helpers shared by the ports.
//!
//! The JS sources (lib/*.js) lean on implicit coercion (`String(v)`,
//! `Number(v)`, truthiness, `Math.round`, UTF-16 `.length`/`.slice`). To keep
//! the Rust port byte-for-byte compatible with the golden fixtures, those
//! semantics are replicated here once and reused everywhere.

use serde_json::Value;

/// `Math.round`: nearest integer, ties toward +Infinity.
/// (`Math.round(-2.5) === -2`, `Math.round(0.49999999999999994) === 0`.)
pub(crate) fn js_math_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// The set trimmed by `String.prototype.trim()` and matched by `/\s/`:
/// ECMAScript WhiteSpace + LineTerminator.
pub(crate) fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}' | '\u{000A}' | '\u{000B}' | '\u{000C}' | '\u{000D}' | '\u{0020}'
            | '\u{00A0}' | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// `String.prototype.trim()`.
pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `string.length` (UTF-16 code units).
pub(crate) fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `string.slice(0, n)` (UTF-16 code units). A surrogate pair split at the
/// boundary becomes U+FFFD (JS would keep a lone surrogate, which cannot be
/// represented in Rust's UTF-8 strings).
pub(crate) fn utf16_slice_to(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    if units.len() <= n {
        s.to_string()
    } else {
        String::from_utf16_lossy(&units[..n])
    }
}

/// `String(number)` for the value ranges this codebase deals in.
/// (Rust's shortest-roundtrip `Display` matches JS for ordinary magnitudes;
/// JS switches to exponent notation only beyond 1e21 / below 1e-6, which the
/// promo/catalog domain never reaches.)
pub(crate) fn js_num_to_string(x: f64) -> String {
    if x.is_nan() {
        "NaN".to_string()
    } else if x.is_infinite() {
        if x > 0.0 { "Infinity".to_string() } else { "-Infinity".to_string() }
    } else if x == 0.0 {
        "0".to_string() // covers -0 too: String(-0) === "0"
    } else {
        format!("{x}")
    }
}

/// JS truthiness for a JSON value.
pub(crate) fn js_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `String(v)` for a JSON value (arrays join with ",", objects become
/// "[object Object]", like JS default `toString`).
pub(crate) fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_num_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|e| match e {
                Value::Null => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// `` `${v}` `` where `v` may be absent (`undefined`).
pub(crate) fn js_tpl(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(v) => js_string(v),
    }
}

/// `Number(string)`: trims JS whitespace, "" -> 0, supports Infinity and
/// 0x/0o/0b prefixes, otherwise a strict decimal literal (else NaN).
pub(crate) fn js_parse_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16u32), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(rest) = t.strip_prefix(prefix) {
            if rest.is_empty() {
                return f64::NAN;
            }
            let mut acc = 0.0f64;
            for c in rest.chars() {
                match c.to_digit(radix) {
                    Some(d) => acc = acc * radix as f64 + d as f64,
                    None => return f64::NAN,
                }
            }
            return acc;
        }
    }
    // Restrict to JS decimal-literal characters so Rust's "inf"/"nan"
    // spellings don't slip through.
    if !t.chars().all(|c| matches!(c, '0'..='9' | '+' | '-' | '.' | 'e' | 'E')) {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number(v)` for a JSON value.
pub(crate) fn js_to_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => js_parse_number(s),
        Value::Array(_) => js_parse_number(&js_string(v)), // ToNumber(ToString(array))
        Value::Object(_) => f64::NAN,
    }
}

/// Group an unsigned digit string with thousands separators
/// (the `\B(?=(\d{3})+(?!\d))` replace used by all three `money()` ports).
pub(crate) fn group_thousands(digits: &str) -> String {
    let n = digits.len();
    let mut out = String::with_capacity(n + n / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (n - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Replace `/\[.*?\]/g`-style segments: drop the leftmost `open`..`close`
/// pair when no line terminator sits between them (`.` does not match line
/// terminators in JS), repeatedly, like a global non-greedy replace.
pub(crate) fn strip_bracketed(s: &str, open: char, close: char) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == open {
            let mut j = i + 1;
            let mut found = None;
            while j < chars.len() {
                let c = chars[j];
                if c == close {
                    found = Some(j);
                    break;
                }
                if matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
                    break;
                }
                j += 1;
            }
            if let Some(j) = found {
                i = j + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn math_round_ties_toward_positive_infinity() {
        assert_eq!(js_math_round(2.5), 3.0);
        assert_eq!(js_math_round(-2.5), -2.0);
        assert_eq!(js_math_round(-0.4), 0.0);
        assert_eq!(js_math_round(0.49999999999999994), 0.0); // not 1
    }

    #[test]
    fn number_coercion() {
        assert_eq!(js_parse_number(""), 0.0);
        assert_eq!(js_parse_number("  12.5 "), 12.5);
        assert_eq!(js_parse_number("0x10"), 16.0);
        assert!(js_parse_number("12abc").is_nan());
        assert!(js_parse_number("inf").is_nan());
        assert_eq!(js_to_number(&json!(null)), 0.0);
        assert_eq!(js_to_number(&json!(true)), 1.0);
        assert_eq!(js_to_number(&json!("1e3")), 1000.0);
    }

    #[test]
    fn string_coercion() {
        assert_eq!(js_string(&json!([1, null, "a"])), "1,,a");
        assert_eq!(js_string(&json!({"a": 1})), "[object Object]");
        assert_eq!(js_num_to_string(26.6699999), "26.6699999");
        assert_eq!(js_num_to_string(-0.0), "0");
    }

    #[test]
    fn bracket_stripping_matches_non_greedy_regex() {
        assert_eq!(strip_bracketed("ขวด [123]", '[', ']'), "ขวด ");
        assert_eq!(strip_bracketed("[a]b]", '[', ']'), "b]");
        assert_eq!(strip_bracketed("a[b", '[', ']'), "a[b");
        assert_eq!(strip_bracketed("x[a\nb]y", '[', ']'), "x[a\nb]y"); // `.` never crosses \n
    }

    #[test]
    fn utf16_helpers() {
        assert_eq!(utf16_len("สนใจ รหัส A100"), 14);
        assert_eq!(utf16_slice_to("สนใจ รหัส LONGCODE123456", 20), "สนใจ รหัส LONGCODE12");
        assert_eq!(utf16_len("🔥"), 2);
    }
}
