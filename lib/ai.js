// AI design assistant — sends the current LINE Flex JSON + a natural-language
// instruction to the Claude API and returns the edited Flex JSON.
// The request is dispatched through the service worker (CORS + key handling).

export const AI_MODEL = 'claude-opus-4-8';
export const AI_ENDPOINT = 'https://api.anthropic.com/v1/messages';

// crm-marketer persona — Thai pharmacy sales/content expert. Used for editing
// flex (advise mode) and for content generation.
export const CRM_PERSONA = `You are the CRM Marketer for "Re-ya", a Thai pharmacy CRM / LINE marketing platform. You are an expert in Thai pharmacy sales copywriting and LINE Flex promo design. Tone: trustworthy, friendly, sales-savvy (โทนร้านยาไทย เป็นกันเอง น่าเชื่อถือ). HARD RULE: never claim drug efficacy, disease cure, or exaggerated medical benefits (ผิดกฎหมายโฆษณายา อย.) — sell on price, promo, value, and convenience only.`;

const EDIT_RULES = `Keep the result valid per the LINE Flex Message spec. Preserve every field you are not changing — especially hero image URLs and the footer button "action". Keep the SAME top-level shape (a single {"type":"flex",...} object, or an array of them). Colors are hex (#RRGGBB): แดง=#E8000D เขียว=#27AE60 น้ำเงิน=#1F6FEB ม่วง=#8E44AD ส้ม=#E67E22 เทา=#999999 ดำ=#222222 ขาว=#FFFFFF. Text sizes: xs sm md lg xl xxl ("ใหญ่ขึ้น" = bump up a step or two).`;

// Reference style examples so the AI knows what the user means when they refer
// to a shop style ("แบบการ์ดโปร", "SPECIAL PROMO", "เหลือง-แดง"). Injected into the edit prompt.
export const STYLE_REFERENCE = `สไตล์อ้างอิงของร้าน (ถ้าผู้ใช้พูดถึงสไตล์เหล่านี้ ให้ทำตามสูตรนี้):
• "SPECIAL PROMO" / "การ์ดโปรร้าน" / "เหลือง-แดง": bubble พื้นหลังทอง #FFC400; ป้ายแดง #E2001A อักษรเหลือง "SPECIAL PROMO" มุมซ้ายบน; พาเนลขาวมน ใส่ชื่อสินค้า(ดำ หนา) + รูปสินค้า(aspectMode fit) + ป้ายแดงเล็ก "รหัส XXXX" ชิดขวา; แถวล่าง "จำนวนจำกัด"(แดง หนา) คู่กับกล่องราคา พื้นขาว ขอบแดง 2px มน เขียน "[หน่วย]ละ"(เล็ก) + ราคาแดงตัวใหญ่ "NNN.-"; ป้ายเขียว #1B8A3A "ส่งฟรี" กลาง; ปุ่มล่างสีแดง. โชว์เฉพาะราคาพิเศษ ไม่ต้องมีราคาขีดฆ่า.
• "classic" / "แบบเดิม": hero รูปเต็มด้านบน + ป้ายสีตาม preset + ชื่อแดง + ราคาปกติขีดฆ่า/ราคาลด/ประหยัด + ปุ่ม.
สี hex มาตรฐาน: ทอง #FFC400 · แดงโปร #E2001A · เขียวส่งฟรี #1B8A3A · ดำ #1A1A1A. ถ้าผู้ใช้ไม่ได้ระบุสไตล์ ให้คงสไตล์เดิมของ JSON ไว้.`;

// Single combined prompt for editing flex (the bridge `claude -p` takes one
// prompt; the API path reuses it as the user message).
//   mode 'apply'  -> return ONLY the edited flex JSON
//   mode 'advise' -> converse first (Thai); only return JSON { advice, flex }
//                    when the user clearly confirms a direction
export function buildEditPrompt(flexJson, instruction, mode = 'apply') {
  const head =
    `${CRM_PERSONA}\n\nคุณกำลังช่วยแก้ดีไซน์ LINE Flex โปรโมชั่นร้านยา\n${EDIT_RULES}\n\n${STYLE_REFERENCE}\n\n` +
    `Flex JSON ปัจจุบัน:\n\`\`\`json\n${flexJson}\n\`\`\`\n\nสิ่งที่ผู้ใช้ต้องการ: ${instruction}\n\n`;
  if (mode === 'advise') {
    return head +
      `คุณคือที่ปรึกษาดีไซน์ — คุยให้ชัดก่อน ค่อยลงมือ ตอบเป็นภาษาไทยเสมอ:\n` +
      `1) ถ้าข้อความของผู้ใช้ยังไม่ได้ยืนยันทิศทางชัดเจน ห้ามส่ง JSON เด็ดขาด ให้เลือกอย่างใดอย่างหนึ่ง:\n` +
      `   • ถามคำถามคม ๆ 1-2 ข้อที่ชี้ขาดดีไซน์ (เช่น เน้นราคาถูก หรือเน้นความน่าเชื่อถือ? กลุ่มลูกค้าคือใคร?)\n` +
      `   • หรือเสนอแนวทางดีไซน์ 2-3 แบบที่จับต้องได้ พร้อมข้อดี-ข้อเสียสั้น ๆ ของแต่ละแบบ ให้ผู้ใช้เลือก\n` +
      `   ตอบเป็นข้อความล้วนเท่านั้น ห้ามมี JSON หรือ code block ใด ๆ ปนมา\n` +
      `2) ส่ง JSON ก็ต่อเมื่อข้อความของผู้ใช้ยืนยันทิศทางชัดเจนแล้วเท่านั้น (เช่นขึ้นต้นว่า "เอาแบบ", "ตกลง", "ใช้", "เอาเลย", "จัดมา")\n` +
      `   เมื่อยืนยันแล้ว คืนผลเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:\n` +
      `{"advice": ["...","..."], "flex": <flex ฉบับเต็มที่ปรับแล้ว>}`;
  }
  return head + `คืนเฉพาะ flex JSON ฉบับเต็มที่แก้แล้ว ห้ามมีคำอธิบายหรือ markdown`;
}

// Pick the right auth header based on the credential type:
//  - API key  (sk-ant-api...) -> x-api-key
//  - OAuth tok (sk-ant-oat...) -> Authorization: Bearer + oauth beta header
// (sending both x-api-key and Authorization makes the API 401, so use one.)
export function authHeaders(key) {
  const k = (key || '').trim();
  const base = {
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (/^sk-ant-oat/i.test(k) || /^sk-ant-oauth/i.test(k)) {
    return { ...base, authorization: `Bearer ${k}`, 'anthropic-beta': 'oauth-2025-04-20' };
  }
  return { ...base, 'x-api-key': k };
}

// Verify the credential against the REAL endpoint (/v1/messages, max_tokens 1).
// GET /v1/models is not enough: OAuth tokens pass /v1/models but are rejected
// on /v1/messages, so only this catches that case.
export function buildTestRequest(key) {
  return {
    url: AI_ENDPOINT,
    method: 'POST',
    headers: { ...authHeaders(key), 'content-type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  };
}

// Anthropic API request to edit flex. mode 'apply' | 'advise'.
export function buildAiRequest(apiKey, flexJson, instruction, mode = 'apply') {
  return {
    url: AI_ENDPOINT,
    headers: { ...authHeaders(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: buildEditPrompt(flexJson, instruction, mode) }],
    }),
  };
}

// Generic Claude Code bridge runner (POST /run { prompt } -> { ok, text }).
// All prompt construction lives in lib/* — used by edit (advise/apply) + content.
export function buildBridgeRunRequest(bridgeUrl, prompt) {
  const base = (bridgeUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  return {
    url: `${base}/run`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  };
}

// Generic Anthropic API text call (for content generation, etc.).
export function buildAiTextRequest(key, prompt, maxTokens = 4000) {
  return {
    url: AI_ENDPOINT,
    method: 'POST',
    headers: { ...authHeaders(key), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    }),
  };
}

// Extract the plain text out of a /v1/messages response.
export function textFromResponse(apiResponse) {
  if (apiResponse?.type === 'error') throw new Error(apiResponse.error?.message || 'API error');
  return (apiResponse?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Free image generation via the Claude Code/Codex bridge (POST /genimage).
// Runs `codex exec` with the user's Codex login — no API key. -> { ok, base64, mime }
// refImage (optional, experimental): { mime, base64 } reference image — the
// bridge writes it to a temp file and asks codex to use it as a reference.
export function buildCodexImageRequest(bridgeUrl, prompt, refImage = null) {
  const base = (bridgeUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  const payload = { prompt };
  if (refImage && refImage.base64) {
    payload.refBase64 = refImage.base64;
    payload.refMime = refImage.mime || 'image/png';
  }
  return {
    url: `${base}/genimage`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// Parse an edit response from raw text.
//   mode 'apply'  -> flex object/array
//   mode 'advise' -> { advice: string[], flex: object|null }
//                    (a plain-text reply — the AI conversing/asking questions —
//                     comes back as { advice:[text], flex:null }, no throw)
export function parseEditResponse(text, mode = 'apply') {
  let obj;
  try {
    obj = JSON.parse(extractJson(text));
  } catch (e) {
    if (mode === 'advise') {
      const advice = String(text || '').trim();
      return { advice: advice ? [advice] : [], flex: null };
    }
    throw e;
  }
  if (mode === 'advise') {
    if (obj && (obj.advice !== undefined || obj.flex !== undefined)) {
      return { advice: Array.isArray(obj.advice) ? obj.advice : [], flex: obj.flex ?? null };
    }
    return { advice: [], flex: obj }; // model returned bare flex
  }
  return obj;
}

// Pull the edited Flex JSON out of a /v1/messages response object.
export function parseFlexFromResponse(apiResponse) {
  if (apiResponse?.type === 'error') {
    throw new Error(apiResponse.error?.message || 'API error');
  }
  const text = (apiResponse?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return parseFlexFromText(text);
}

// Parse edited Flex JSON out of raw model/CLI text output.
export function parseFlexFromText(text) {
  if (!text || !text.trim()) throw new Error('ไม่มีข้อความตอบกลับ');
  return JSON.parse(extractJson(text));
}

// Tolerant extraction: strip code fences, then slice from the first opening
// bracket to the last matching closing bracket.
function extractJson(text) {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const candidates = [firstObj, firstArr].filter((i) => i >= 0);
  if (!candidates.length) return s;
  const start = Math.min(...candidates);
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  return end > start ? s.slice(start, end + 1) : s.slice(start);
}
