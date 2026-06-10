// Content copy generator — builds a single prompt string for a CRM-marketer
// persona (โทน Re-ya) that writes Thai pharmacy marketing copy. The prompt is
// later piped to `claude -p`, so this module is PURE: no DOM, no Electron, no
// external imports. Facts are grounded to the supplied products only.

const HARD_SAFETY_RULE =
  'ห้ามกล่าวอ้างสรรพคุณยา/รักษาโรค/เคลมเกินจริง (ผิดกฎหมายโฆษณายา อย.) — เน้นราคา/โปร/ความคุ้มค่า/ความน่าเชื่อถือเท่านั้น';

const ALL_TYPES = ['altText', 'closingText', 'caption', 'headline'];

const TONE_TH = {
  urgent: 'เร่งด่วน กระตุ้นให้รีบตัดสินใจ (เน้นของจำกัด/หมดเขตไว)',
  warm: 'อบอุ่น เป็นกันเอง ดูแลใส่ใจลูกค้า',
  formal: 'สุภาพ ทางการ น่าเชื่อถือ',
};

const AUDIENCE_TH = {
  general: 'ลูกค้าทั่วไป',
  member: 'สมาชิกร้าน (เน้นสิทธิพิเศษสมาชิก)',
  senior: 'ผู้สูงอายุ (ใช้ภาษาเรียบง่าย ชัดเจน อ่านง่าย)',
};

const LENGTH_TH = {
  short: 'สั้น กระชับ',
  medium: 'ปานกลาง',
  long: 'ยาว ให้รายละเอียดครบ',
};

function pickTone(tone) {
  return TONE_TH[tone] ? tone : 'warm';
}

function pickAudience(audience) {
  return AUDIENCE_TH[audience] ? audience : 'general';
}

function pickLength(length) {
  return LENGTH_TH[length] ? length : 'medium';
}

function pickTypes(types) {
  if (!Array.isArray(types) || types.length === 0) return ALL_TYPES.slice();
  const filtered = ALL_TYPES.filter((t) => types.includes(t));
  return filtered.length === 0 ? ALL_TYPES.slice() : filtered;
}

function priceText(value) {
  return (value === undefined || value === null || value === '')
    ? '-'
    : String(value);
}

function formatProduct(p, index) {
  const lines = [
    `  ${index + 1}. code: ${p && p.code !== undefined ? p.code : '-'}`,
    `     name: ${p && p.name !== undefined ? p.name : '-'}`,
    `     priceNormal: ${priceText(p && p.priceNormal)}`,
    `     priceSale: ${priceText(p && p.priceSale)}`,
    `     condition(note): ${p && p.note ? p.note : '-'}`,
  ];
  return lines.join('\n');
}

/**
 * Build a single prompt string for the CRM-marketer persona.
 * @param {Array<object>} products grounding facts (use ONLY these)
 * @param {object} [opts] { types, tone, audience, length }
 * @returns {string}
 */
export function buildContentPrompt(products, opts = {}) {
  const list = Array.isArray(products) ? products : [];
  const types = pickTypes(opts.types);
  const tone = pickTone(opts.tone);
  const audience = pickAudience(opts.audience);
  const length = pickLength(opts.length);

  const productBlock = list.length
    ? list.map(formatProduct).join('\n')
    : '  (ไม่มีสินค้า)';

  const wantAlt = types.includes('altText');
  const wantClosing = types.includes('closingText');
  const wantCaption = types.includes('caption');
  const wantHeadline = types.includes('headline');

  const requestedDesc = [
    `- altText: ${wantAlt ? 'ต้องการ (สรุปสำหรับ accessibility/preview, ความยาว <= 400 ตัวอักษร)' : 'ไม่ต้องการ — ใส่ค่าว่าง ""'}`,
    `- closingText: ${wantClosing ? 'ต้องการ (ข้อความปิดท้าย/call-to-action)' : 'ไม่ต้องการ — ใส่ค่าว่าง ""'}`,
    `- captions: ${wantCaption ? 'ต้องการ 2 แคปชัน (array ที่มี 2 ข้อความ)' : 'ไม่ต้องการ — ใส่ array ว่าง []'}`,
    `- headline: ${wantHeadline ? 'ต้องการ (พาดหัวสั้นดึงดูด)' : 'ไม่ต้องการ — ใส่ค่าว่าง ""'}`,
  ].join('\n');

  return [
    'คุณคือนักการตลาด CRM ร้านยาไทย โทน Re-ya, ผู้เชี่ยวชาญ copy ขาย',
    'ภารกิจ: เขียน marketing copy ภาษาไทยสำหรับโปรโมชันร้านยา ให้ดึงดูดและน่าเชื่อถือ',
    '',
    'ข้อมูลสินค้า (grounding facts) — ใช้ได้เฉพาะข้อมูลนี้เท่านั้น ห้ามมั่ว/เพิ่มสินค้า/แต่งราคาเอง:',
    productBlock,
    '',
    'กฎความปลอดภัย (HARD SAFETY RULE — ห้ามฝ่าฝืนเด็ดขาด):',
    HARD_SAFETY_RULE,
    '',
    'สไตล์ที่ต้องการ:',
    `- โทน (tone): ${tone} — ${TONE_TH[tone]}`,
    `- กลุ่มเป้าหมาย (audience): ${audience} — ${AUDIENCE_TH[audience]}`,
    `- ความยาว (length): ${length} — ${LENGTH_TH[length]}`,
    '- เขียนเป็นภาษาไทยทั้งหมด',
    '',
    'สิ่งที่ต้องสร้าง (สร้างเฉพาะที่ระบุว่า "ต้องการ" เท่านั้น):',
    requestedDesc,
    '',
    'รูปแบบผลลัพธ์ (สำคัญมาก):',
    'ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น ห้ามมี markdown ห้ามมี code fence',
    'โครงสร้าง JSON ที่ต้องการ:',
    '{ "altText": string (<=400), "closingText": string, "captions": string[2], "headline": string }',
    'ช่องที่ไม่ได้ร้องขอ ให้ใส่ค่าว่าง: string ใช้ "" และ captions ใช้ []',
  ].join('\n');
}

/**
 * Tolerant parse of the model response into the content shape.
 * Strips ```json fences, slices first '{' .. last '}', then JSON.parse.
 * @param {string} text
 * @returns {{altText:string, closingText:string, captions:string[], headline:string}}
 */
export function parseContentResponse(text) {
  if (typeof text !== 'string') {
    throw new Error('parseContentResponse: expected a string response');
  }

  let body = text.replace(/```json/gi, '').replace(/```/g, '');

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('parseContentResponse: no JSON object found in response');
  }

  const slice = body.slice(start, end + 1);
  const parsed = JSON.parse(slice);

  return {
    altText: typeof parsed.altText === 'string' ? parsed.altText : '',
    closingText: typeof parsed.closingText === 'string' ? parsed.closingText : '',
    captions: Array.isArray(parsed.captions) ? parsed.captions : [],
    headline: typeof parsed.headline === 'string' ? parsed.headline : '',
  };
}
