// Card renderer — ports the cny-promo-creative skill's render.py to Electron.
// Fills a normalized promo `record` into an HTML template (Template A = white
// production card, Template B = themed poster with a Layer-0 background) and
// screenshots it to PNG with Electron's bundled Chromium — so the price/name/SKU
// (Layer 2) are always crisp vector text and Thai never mis-renders.
//
// Layer model (same as the skill):
//   Layer 0 background : Template B only — built-in theme HTML or an AI/uploaded bg
//   Layer 1 product    : record.photo (a data: URI passed in by the caller)
//   Layer 2 text       : HTML/CSS — exact numbers, embedded Prompt/Sarabun fonts
//
// Public API:  renderCard(record, opts) -> Promise<dataURL>  (PNG)

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let seq = 0;

// A BrowserWindow's surface is clamped to the display work area, so pick the
// largest zoom where BOTH card dimensions fit (never bigger than the requested
// @scale). The fixed-size card is then zoom-fit into it — full card, never cropped.
function fitZoom(scale, w, h) {
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const workW = Math.max(320, wa.width - 16);
    const workH = Math.max(320, wa.height - 16);
    return Math.min(scale, workW / w, workH / h);
  } catch { return Math.min(scale, 1); } // safe default if `screen` isn't ready
}

const ASSETS = path.join(__dirname, '..', 'assets', 'cards');
const CANVAS = 1080;          // default logical card size (matches tokens.css --canvas-w/-h)
const DEFAULT_SCALE = 2;      // @2x output, like the skill

// ขนาดการ์ดที่รองรับ — tokens.css default 1080x1080; ขนาดอื่น inject override ตอน render
const SIZES = {
  square:   { w: 1080, h: 1080 },  // 1:1 social
  portrait: { w: 1080, h: 1350 },  // 4:5 feed
  story:    { w: 1080, h: 1920 },  // 9:16 story
  line:     { w: 1040, h: 1040 },  // LINE imagemap/rich
};

const read = (p) => fs.readFileSync(p, 'utf8');

// tokens.css references fonts as url('{{FONT_DIR}}/Name.ttf'); inline each as a
// base64 data: URI so the rendered HTML is fully self-contained (no file:// font
// loads, no temp-dir asset juggling).
function tokensCss() {
  let css = read(path.join(ASSETS, 'tokens.css'));
  return css.replace(/url\(['"]?\{\{FONT_DIR\}\}\/([^'")]+)['"]?\)/g, (_m, file) => {
    const b64 = fs.readFileSync(path.join(ASSETS, 'fonts', file)).toString('base64');
    return `url(data:font/ttf;base64,${b64})`;
  });
}

function dataUri(rel) {
  const ext = (path.extname(rel).slice(1) || 'png').toLowerCase();
  const mt = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', svg: 'svg+xml' }[ext] || 'png';
  const b64 = fs.readFileSync(path.join(ASSETS, rel)).toString('base64');
  return `data:image/${mt};base64,${b64}`;
}

// Port of render.py fmt_price: 1,234 (drops .00) or 1,234.50.
function fmtPrice(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Values shared by every template (port of render.py common_ctx).
function commonCtx(rec) {
  const save = rec.save != null ? Number(rec.save) : null;
  return {
    '{{TOKENS_CSS}}': tokensCss(),
    '{{LOGO}}': dataUri('brand/cny_logo.png'),
    '{{FOOTER}}': read(path.join(ASSETS, 'templates', '_footer.html')),
    '{{NAME}}': rec.name || '',
    '{{PHOTO}}': rec.photo || '',
    '{{SKU}}': rec.sku || '',
    '{{PRICE_NOW}}': fmtPrice(rec.price_special != null ? rec.price_special : rec.price_normal),
    '{{SAVE_BURST}}': save ? `<div class="save-burst">ประหยัด ฿${fmtPrice(save)}</div>` : '',
    _save: save,
    _normal: rec.price_normal != null ? Number(rec.price_normal) : null,
    _unit: rec.pack_unit || 'หน่วย',
    _pack: rec.pack_text || '',
  };
}

const fillTokens = (tpl, repl) =>
  Object.entries(repl).reduce((s, [k, v]) => s.split(k).join(String(v ?? '')), tpl);

// Template A — white single-product card.
function buildA(rec) {
  const tpl = read(path.join(ASSETS, 'templates', 'template_a.html'));
  const c = commonCtx(rec);
  const repl = onlyTokens(c);
  repl['{{BG_STYLE}}'] = 'background:#FFFFFF;';
  repl['{{PRICE_WAS}}'] = c._save ? `${c._unit}ละ ฿${fmtPrice(c._normal)}` : '';
  repl['{{PACK_NOTE}}'] = c._pack;
  return fillTokens(tpl, repl);
}

// Layer 0 for Template B: an AI/uploaded background (data: URI) or a built-in theme.
function buildBgLayer({ bg, theme } = {}) {
  if (bg) return `<img class="bg-img" src="${bg}" alt="">`;
  if (theme) {
    const f = path.join(ASSETS, 'themes', `${theme}.html`);
    if (fs.existsSync(f)) return read(f);
  }
  return '';
}

// Template B — themed / seasonal poster.
function buildB(rec, { bg, theme, cta } = {}) {
  const tpl = read(path.join(ASSETS, 'templates', 'template_b.html'));
  const c = commonCtx(rec);
  const repl = onlyTokens(c);
  repl['{{BG_LAYER}}'] = buildBgLayer({ bg, theme });
  repl['{{CTA}}'] = cta || 'สั่งเลย • ทักแชทร้าน';
  repl['{{PRICE_WAS}}'] = c._save ? `ราคาปกติ ฿${fmtPrice(c._normal)}` : '';
  let disc = '';
  if (c._save && c._normal) {
    const pct = Math.round((c._save / c._normal) * 100);
    if (pct >= 1) disc = `<div class="disc"><span class="l">ลด</span><span class="p">${pct}%</span></div>`;
  }
  repl['{{DISC_BADGE}}'] = disc;
  return fillTokens(tpl, repl);
}

const onlyTokens = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('{{')));

// Template C — partner / GWP "ซื้อครบ X แถม Y" (form-driven; no price math).
// rec: { title, brands?, buy_text, gift_text, gift_photo?, gift_sku?, qty_text?, period_text? }
function buildC(rec) {
  const tpl = read(path.join(ASSETS, 'templates', 'template_c.html'));
  const repl = {
    '{{TOKENS_CSS}}': tokensCss(),
    '{{LOGO}}': dataUri('brand/cny_logo.png'),
    '{{FOOTER}}': read(path.join(ASSETS, 'templates', '_footer.html')),
    '{{TITLE}}': rec.title || 'โปรพาร์ทเนอร์',
    '{{BRANDS}}': rec.brands || '',
    '{{BUY_TEXT}}': rec.buy_text || '',
    '{{GIFT_TEXT}}': rec.gift_text || '',
    '{{GIFT_PHOTO_TAG}}': rec.gift_photo ? `<img class="gift-photo" src="${rec.gift_photo}" alt="">` : '',
    '{{GIFT_SKU_TAG}}': rec.gift_sku ? `<div class="gift-sku">รหัส ${rec.gift_sku}</div>` : '',
    '{{QTY_TAG}}': rec.qty_text ? `<div class="qty">${rec.qty_text}</div>` : '',
    '{{PERIOD_TEXT}}': rec.period_text || '',
  };
  return fillTokens(tpl, repl);
}

function buildHtml(rec, opts = {}) {
  if (opts.template === 'c') return buildC(rec);
  return opts.template === 'b' ? buildB(rec, opts) : buildA(rec);
}

// Render filled HTML to a PNG data URL via a hidden Chromium window.
//   - Loads a temp file (data: URLs have a ~2 MB nav limit the inlined fonts blow past).
//   - enableDeviceEmulation pins the viewport to the 1080px card regardless of the
//     physical screen (a plain window clamps content to the work area), and
//     deviceScaleFactor renders it at @Nx for a crisp capture.
// One reused offscreen window for every render. Creating/destroying an offscreen
// BrowserWindow per card crashes the GPU process when done back-to-back (e.g. a
// multi-product batch), so keep a single hidden surface alive instead.
let sharedWin = null;
function ensureWin() {
  if (sharedWin && !sharedWin.isDestroyed()) return sharedWin;
  sharedWin = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { webSecurity: false, offscreen: true },
  });
  sharedWin.webContents.setFrameRate(5);
  return sharedWin;
}

async function doCapture(html, scale, w, h) {
  const z = fitZoom(scale, w, h);
  const pw = Math.round(w * z);
  const ph = Math.round(h * z);
  // zoom-fit the fixed-size layout into the (screen-bounded) capture surface.
  const scaled = html.replace('<head>', `<head><style>html{zoom:${z};}</style>`);
  const tmp = path.join(os.tmpdir(), `flexpromo-card-${process.pid}-${++seq}.html`);
  fs.writeFileSync(tmp, scaled, 'utf8');

  const win = ensureWin();
  try {
    win.setContentSize(pw, ph);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('render timeout')), 20000);
      const fail = (_e, code, desc) => { cleanup(); reject(new Error(`load failed ${code} ${desc || ''}`.trim())); };
      const ok = () => { cleanup(); resolve(); };
      const cleanup = () => {
        clearTimeout(timer);
        win.webContents.off('did-fail-load', fail);
        win.webContents.off('did-finish-load', ok);
      };
      win.webContents.once('did-fail-load', fail);
      win.webContents.once('did-finish-load', ok);
      win.loadFile(tmp);
    });
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => {});
    await new Promise((r) => setTimeout(r, 350)); // let the product image + fonts paint
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: pw, height: ph });
    return image.toDataURL();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// Serialize renders onto the single shared window (no overlapping loadFile calls).
let chain = Promise.resolve();
function capture(html, scale = DEFAULT_SCALE, w = CANVAS, h = CANVAS) {
  const run = () => doCapture(html, scale, w, h);
  chain = chain.then(run, run);
  return chain;
}

/**
 * @param {{name?:string, photo?:string, sku?:string, price_normal?:number,
 *          price_special?:number, save?:number, pack_unit?:string, pack_text?:string}} record
 * @param {{template?:'a'|'b'|'c', theme?:string, bg?:string, cta?:string, scale?:number,
 *          size?:'square'|'portrait'|'story'|'line'}} [opts]
 * @returns {Promise<string>} PNG data URL
 */
async function renderCard(record, opts = {}) {
  const { w, h } = SIZES[opts.size] || SIZES.square;
  let html = buildHtml(record, opts);
  // tokens.css :root ตั้ง --canvas-w/-h ไว้ 1080 — ขนาดอื่น override ท้าย <head>
  // (ต้องมาหลัง {{TOKENS_CSS}} ไม่งั้นโดน :root ใน tokens ทับ)
  if (w !== CANVAS || h !== CANVAS) {
    html = html.replace('</head>', `<style>:root{--canvas-w:${w}px;--canvas-h:${h}px;}</style></head>`);
  }
  return capture(html, opts.scale || DEFAULT_SCALE, w, h);
}

module.exports = { renderCard };
