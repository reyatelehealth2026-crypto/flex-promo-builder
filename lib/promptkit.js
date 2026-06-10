// PromptKit — marketing-grade prompt composer for CNY Healthcare image gen.
// Pure ES module, no DOM, no deps. Used by both gen modes:
//   - 'product' : image-to-image from a product reference photo
//   - 'bg'      : background-only scene for a promo card (empty center stage)
// Hard rule: NEVER ask the AI to render Thai text / numbers — all text comes
// from the HTML overlay, so every composition ends with a no-text safety tail.

export const PROMPT_KIT = {
  // จุดประสงค์ (product mode)
  purpose: [
    {
      id: 'ads',
      label: 'โฆษณา',
      frag: 'high-impact advertising hero shot, bold composition, strong focal point on the product, eye-catching commercial photography',
    },
    {
      id: 'poster',
      label: 'โปสเตอร์',
      frag: 'promotional poster composition, product placed in lower two-thirds, generous open space above for headline overlay, balanced visual hierarchy',
    },
    {
      id: 'product_info',
      label: 'แนะนำสินค้า',
      frag: 'clean product showcase, informative catalog style, product clearly visible and well lit, neutral presentation that highlights packaging details',
    },
    {
      id: 'drug_info',
      label: 'แนะนำยา',
      frag: 'professional pharmacy presentation, clean clinical and trustworthy look, calm reassuring tone, no medical claims text, no exaggerated cure imagery, no before-after comparison, suitable for a licensed Thai pharmacy',
    },
    {
      id: 'social_post',
      label: 'โพสต์โซเชียล',
      frag: 'scroll-stopping social media visual, vibrant but tasteful, square-friendly centered composition, lifestyle appeal for Facebook and LINE feeds',
    },
  ],

  // สไตล์ภาพ
  style: [
    { id: 'studio', label: 'สตูดิโอ', frag: 'professional studio photography, seamless backdrop, controlled softbox lighting, crisp shadows' },
    { id: 'lifestyle', label: 'ไลฟ์สไตล์', frag: 'natural lifestyle setting, everyday home or pharmacy environment, candid warm atmosphere' },
    { id: 'flatlay', label: 'แฟลตเลย์', frag: 'top-down flat lay arrangement, neatly styled props around the edges, clean surface' },
    { id: 'premium', label: 'พรีเมียม', frag: 'luxury premium aesthetic, elegant dark or satin backdrop, dramatic rim lighting, high-end product photography' },
    { id: 'minimal', label: 'มินิมอล', frag: 'minimalist composition, lots of negative space, single accent color, simple geometric shapes' },
    { id: 'photo_real', label: 'สมจริง', frag: 'ultra photorealistic, 8k detail, natural color grading, shot on professional DSLR with 85mm lens' },
  ],

  // ธีม / ซีซั่น
  theme: [
    { id: 'cny_redgold', label: 'ตรุษจีน แดง-ทอง', frag: 'Chinese New Year theme, rich red and gold color palette, festive oriental patterns, lanterns softly glowing in background' },
    { id: 'clean_blue', label: 'ฟ้า-ขาว สะอาด เภสัช', frag: 'clean pharmacy theme, light blue and white color palette, fresh hygienic feel, soft gradient background' },
    { id: 'nature_green', label: 'ธรรมชาติ เขียว', frag: 'natural green theme, fresh leaves and botanical elements, organic healthy atmosphere, soft daylight' },
    { id: 'pastel_soft', label: 'พาสเทล นุ่มนวล', frag: 'soft pastel color palette, gentle pink peach and cream tones, dreamy diffused light, friendly approachable mood' },
    { id: 'songkran', label: 'สงกรานต์ ฟ้า-น้ำ', frag: 'Songkran festival theme, refreshing blue and aqua water tones, splashing water droplets, bright Thai summer feel' },
    { id: 'newyear_gold', label: 'ปีใหม่ ทอง', frag: 'New Year celebration theme, champagne gold and deep navy palette, glittering festive ambience' },
    { id: 'none', label: 'ไม่ระบุธีม', frag: '' },
  ],

  // องค์ประกอบประกอบฉาก (เลือกได้หลายอัน)
  elements: [
    { id: 'angpao', label: 'อั่งเปา', frag: 'red envelopes (ang pao) placed decoratively at the edges' },
    { id: 'flowers', label: 'ดอกไม้', frag: 'fresh flowers and petals arranged around the border' },
    { id: 'gift_box', label: 'กล่องของขวัญ', frag: 'wrapped gift boxes with ribbons in the background' },
    { id: 'natural_light', label: 'แสงธรรมชาติ', frag: 'soft natural window light with gentle shadows' },
    { id: 'bokeh', label: 'โบเก้', frag: 'beautiful bokeh light orbs in the blurred background' },
    { id: 'water_splash', label: 'สายน้ำกระเซ็น', frag: 'dynamic water splash frozen in motion around the scene' },
    { id: 'sparkle', label: 'ประกายวิบวับ', frag: 'subtle sparkle and shimmer particles catching the light' },
    { id: 'none', label: 'ไม่มี', frag: '' },
  ],

  // อารมณ์ภาพ
  mood: [
    { id: 'warm', label: 'อบอุ่น', frag: 'warm inviting mood, golden hour color temperature, cozy feeling' },
    { id: 'urgent', label: 'เร่งด่วน ลดแรง', frag: 'high-energy sale atmosphere, dynamic diagonal composition, bold saturated colors that convey urgency' },
    { id: 'trustworthy', label: 'น่าเชื่อถือ', frag: 'calm professional and trustworthy mood, balanced symmetric composition, clean reassuring tones' },
    { id: 'festive', label: 'เทศกาล รื่นเริง', frag: 'joyful festive celebration mood, lively decorative atmosphere, cheerful bright lighting' },
  ],
};

// หา frag จาก id ในหมวดที่กำหนด — ข้าม 'none' / id ที่ไม่รู้จัก / frag ว่าง
function fragOf(category, id) {
  if (!id || id === 'none') return '';
  const entry = (PROMPT_KIT[category] || []).find((e) => e.id === id);
  return entry ? entry.frag : '';
}

const SAFETY_TAIL = 'no text, no captions, no watermark';

// ประกอบ prompt จากตัวเลือกใน UI
// opts: { mode:'product'|'bg', purposeId, styleId, themeId, elementIds:[], moodId, productName?, extra? }
export function composePrompt(opts = {}) {
  const {
    mode = 'product',
    purposeId,
    styleId,
    themeId,
    elementIds = [],
    moodId,
    productName,
    extra,
  } = opts;

  const parts = [];

  if (mode === 'bg') {
    parts.push(
      'promotional background scene for a Thai pharmacy promo card',
      'empty center stage area reserved for product placement, no text, no letters, no numbers, no watermark',
      'decorative elements kept to the edges and corners, the center kept clear and uncluttered'
    );
  } else {
    parts.push(
      'professional product photograph' + (productName ? ` of ${String(productName).trim()}` : ''),
      'keep the exact product from the reference photo unchanged, do not alter label or packaging'
    );
  }

  const purposeFrag = fragOf('purpose', purposeId);
  if (mode === 'product' && purposeFrag) parts.push(purposeFrag);

  const styleFrag = fragOf('style', styleId);
  if (styleFrag) parts.push(styleFrag);

  const themeFrag = fragOf('theme', themeId);
  if (themeFrag) parts.push(themeFrag);

  const ids = Array.isArray(elementIds) ? elementIds : [];
  for (const id of ids) {
    const f = fragOf('elements', id);
    if (f) parts.push(f);
  }

  const moodFrag = fragOf('mood', moodId);
  if (moodFrag) parts.push(moodFrag);

  const extraText = typeof extra === 'string' ? extra.trim() : '';
  if (extraText) parts.push(extraText);

  parts.push(SAFETY_TAIL);

  return parts.filter(Boolean).join(', ');
}

// ค่าเริ่มต้นที่เหมาะกับแต่ละโหมด
export function defaultSelection(mode = 'product') {
  if (mode === 'bg') {
    return {
      mode: 'bg',
      purposeId: null, // bg mode ไม่ใช้ purpose
      styleId: 'studio',
      themeId: 'cny_redgold',
      elementIds: ['bokeh'],
      moodId: 'festive',
    };
  }
  return {
    mode: 'product',
    purposeId: 'ads',
    styleId: 'studio',
    themeId: 'clean_blue',
    elementIds: ['natural_light'],
    moodId: 'trustworthy',
  };
}

// ---- self-test: node lib/promptkit.js --------------------------------------
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url.replace(/\\/g, '/').toLowerCase().endsWith(
    process.argv[1].replace(/\\/g, '/').toLowerCase().split('/').pop()
  );

if (isMain) {
  let pass = 0;
  let fail = 0;
  const check = (name, prompt, mustContain) => {
    const missing = mustContain.filter((s) => !prompt.includes(s));
    if (missing.length === 0) {
      pass++;
      console.log(`PASS ${name}`);
    } else {
      fail++;
      console.log(`FAIL ${name} — missing: ${missing.join(' | ')}`);
    }
    console.log(`  → ${prompt}\n`);
  };

  // 1) product / ads / studio
  const p1 = composePrompt({
    mode: 'product',
    purposeId: 'ads',
    styleId: 'studio',
    themeId: 'none',
    elementIds: ['none'],
    moodId: 'urgent',
    productName: 'Blackmores Fish Oil 1000mg',
  });
  check('product/ads/studio', p1, [
    'keep the exact product from the reference photo unchanged',
    'Blackmores Fish Oil 1000mg',
    'advertising hero shot',
    'studio photography',
    SAFETY_TAIL,
  ]);

  // 2) bg / cny_redgold + angpao + flowers
  const p2 = composePrompt({
    mode: 'bg',
    styleId: 'premium',
    themeId: 'cny_redgold',
    elementIds: ['angpao', 'flowers'],
    moodId: 'festive',
  });
  check('bg/cny_redgold+angpao+flowers', p2, [
    'empty center stage area reserved for product placement',
    'no letters, no numbers',
    'red and gold',
    'ang pao',
    'fresh flowers',
    SAFETY_TAIL,
  ]);

  // 3) product / drug_info — compliance-safe
  const p3 = composePrompt({
    mode: 'product',
    purposeId: 'drug_info',
    styleId: 'photo_real',
    themeId: 'clean_blue',
    elementIds: ['natural_light'],
    moodId: 'trustworthy',
    productName: 'Tylenol 500',
    extra: 'shallow depth of field',
  });
  check('product/drug_info', p3, [
    'do not alter label or packaging',
    'no medical claims text',
    'trustworthy',
    'shallow depth of field',
    SAFETY_TAIL,
  ]);

  console.log(fail === 0 ? `ALL PASS (${pass}/${pass + fail})` : `FAILED ${fail}/${pass + fail}`);
  if (fail > 0) process.exit(1);
}
