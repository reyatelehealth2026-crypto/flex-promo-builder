// Validation — enforce the LINE Flex constraints from the design doc:
//   - carousel <= 12 bubbles
//   - payload <= ~50KB
//   - hero image URLs must be https
// Also surfaces a real-time byte count for the UI.

export const MAX_BUBBLES = 12;
export const MAX_BYTES = 50 * 1024; // ~50KB hard limit
export const WARN_BYTES = 45 * 1024; // start warning before the limit

export function byteLength(objOrString) {
  const str = typeof objOrString === 'string' ? objOrString : JSON.stringify(objOrString);
  return new TextEncoder().encode(str).length;
}

// Validate a single carousel. Returns { ok, errors[], warnings[], bytes }.
export function validate(carousel) {
  const errors = [];
  const warnings = [];

  if (!carousel || carousel.type !== 'carousel') {
    return { ok: false, errors: ['โครงสร้างไม่ใช่ carousel'], warnings, bytes: 0 };
  }

  const bubbles = Array.isArray(carousel.contents) ? carousel.contents : [];

  if (bubbles.length === 0) {
    errors.push('ยังไม่มี bubble (ยังไม่ได้เลือกสินค้า)');
  }
  if (bubbles.length > MAX_BUBBLES) {
    errors.push(`carousel มี ${bubbles.length} bubble เกินขีดจำกัด ${MAX_BUBBLES}`);
  }

  bubbles.forEach((b, i) => {
    const url = firstImageUrl(b);
    if (!/^https:\/\//i.test(url)) {
      errors.push(`bubble ${i + 1}: รูปสินค้าต้องเป็น https (${url || 'ว่าง'})`);
    }
    const label = b?.footer?.contents?.[0]?.action?.label || '';
    if (label.length > 20) {
      warnings.push(`bubble ${i + 1}: label ปุ่มยาวเกิน 20 ตัวอักษร`);
    }
  });

  const bytes = byteLength(carousel);
  if (bytes > MAX_BYTES) {
    errors.push(`payload ${fmtBytes(bytes)} เกินขีดจำกัด ${fmtBytes(MAX_BYTES)}`);
  } else if (bytes > WARN_BYTES) {
    warnings.push(`payload ${fmtBytes(bytes)} ใกล้เกินขีดจำกัด ${fmtBytes(MAX_BYTES)}`);
  }

  return { ok: errors.length === 0, errors, warnings, bytes };
}

// First image URL in a bubble — hero (classic) or first image inside body
// (SPECIAL PROMO template panel).
function firstImageUrl(b) {
  if (b && b.hero && typeof b.hero.url === "string") return b.hero.url;
  return findImageUrl(b && b.body) || "";
}
function findImageUrl(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "image" && typeof node.url === "string") return node.url;
  if (Array.isArray(node.contents)) {
    for (const k of node.contents) { const u = findImageUrl(k); if (u) return u; }
  }
  return "";
}

export function fmtBytes(n) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}
