// Side panel controller: source → select (grid/list) → preset → preview → AI edit → export.

import { sheetCsvUrl, normalizeFromCsv, normalizeFromJson } from '../lib/adapters.js';
import { cnyPageUrl, flattenCnyPages, cnyToProduct, normalizeFromCny, isCnyPayload, filterCny } from '../lib/cny.js';
import { extractPromotions, buildPromoProducts, money } from '../lib/promo.js';
import { buildCarousels, buildFlexMessage } from '../lib/flex-builder.js';
import { validate, fmtBytes } from '../lib/validate.js';
import { buildAiRequest, buildTestRequest, buildBridgeRunRequest, buildEditPrompt, buildAiTextRequest, buildCodexImageRequest, textFromResponse, parseEditResponse } from '../lib/ai.js';
import { buildBanner } from '../lib/compositor.js';
import { PROMPT_KIT, composePrompt, defaultSelection } from '../lib/promptkit.js';
import { cutoutWhiteBg, isMostlyWhiteEdges } from '../lib/cutout.js';
import { buildImageRequest, parseImageResponse } from '../lib/imagegen.js';
import { buildUploadRequest, parseUploadResponse } from '../lib/imagehost.js';
import { buildContentPrompt, parseContentResponse } from '../lib/content.js';

const BASE_PRESETS = [
  ['flash', '⚡ Flash Sale'],
  ['lastlot', '🔥 ล็อตสุดท้าย'],
  ['member', '💎 ราคาสมาชิก'],
  ['custom', 'กำหนดเอง'],
];
// user-defined presets ({id,label,badgeText,badgeColor}) live alongside the base set
let customPresets = [];
const presetOptions = () => [...BASE_PRESETS, ...customPresets.map((c) => [c.id, c.label])];
const SIZE_PX = { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 };
const KIT_KEY = { purpose: 'purposeId', style: 'styleId', theme: 'themeId', mood: 'moodId' };
const KIT_LABEL = { purpose: 'จุดประสงค์', style: 'สไตล์', theme: 'ธีม/โทนสี', elements: 'องค์ประกอบ', mood: 'อารมณ์' };
const GET_PROMOTION = 'https://www.cnypharmacy.com/api/getPromotionProduct';

// ---- state ----------------------------------------------------------------
let products = [];
const presetByCode = new Map();
const selectedCodes = new Set();
let search = '';
let viewMode = 'grid';
let page = 1;               // product-list pagination (rendering 6k cards at once freezes the DOM)
const PER_PAGE = 60;
let sortBy = '';            // '' | 'discount' | 'expiry'
let pFilter = 'all';        // 'all' | 'discount' | 'giveaway' — promo-type chips above the list
let genMode = 'product';    // AI image gen mode: 'product' (ref-based) | 'bg' (scene only)
const kitSel = { product: defaultSelection('product'), bg: defaultSelection('bg') };
let aiOverride = null; // when set, preview/export use this AI-edited flex payload
let lastSourceLabel = ''; // for the cache hint (e.g. "โปรโมชัน")
let chatMode = 'advise'; // 'advise' (suggest then apply) | 'apply' (edit now)
let refImage = null; // { mime, base64 } reference image for AI image gen (image-to-image)
let promoLogo = null; // data URL of the shop logo for the SPECIAL PROMO card

// ---- dom helpers ----------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function empty(text) { const e = el('div', 'empty'); e.textContent = text; return e; }
function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

// ---- init -----------------------------------------------------------------
init();

async function init() {
  bindTabs();
  bindSourceButtons();
  bindProductControls();
  bindExport();
  bindChat();
  bindMainTabs();
  bindModeToggle();
  bindImageTab();
  bindContentTab();
  await restore();
  rebuild();
}

function bindMainTabs() {
  $('#main-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.maintab');
    if (!t) return;
    $$('.maintab').forEach((x) => x.classList.toggle('active', x === t));
    const which = t.dataset.mainpane;
    $$('.mainpane').forEach((p) => p.classList.toggle('hidden', p.dataset.mainpane !== which));
  });
}

function bindModeToggle() {
  $('#mode-advise').addEventListener('click', () => setChatMode('advise'));
  $('#mode-apply').addEventListener('click', () => setChatMode('apply'));
}
function setChatMode(m) {
  chatMode = m;
  $('#mode-advise').classList.toggle('active', m === 'advise');
  $('#mode-apply').classList.toggle('active', m === 'apply');
}

function bindTabs() {
  $('#source-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const which = tab.dataset.source;
    $$('.source-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== which));
  });
}

function bindSourceButtons() {
  $('#load-promo').addEventListener('click', loadPromo);
  $('#promo-token').addEventListener('change', () => save({ promoToken: $('#promo-token').value.trim() }));
  $('#load-cny').addEventListener('click', loadCny);
  $('#load-sheet').addEventListener('click', loadSheet);
  $('#load-json-url').addEventListener('click', loadJsonUrl);
  $('#json-file').addEventListener('change', loadJsonFile);
}

// ---- loaders --------------------------------------------------------------
async function loadPromo() {
  const token = $('#promo-token').value.trim();
  save({ promoToken: token }); // remember the full-set token for next launch
  loadStatus('กำลังโหลดแคตตาล็อก + แคมเปญโปร…');

  const first = await proxyFetch(cnyPageUrl(1, 100));
  if (!first.ok) return loadStatus(`โหลดไม่สำเร็จ (${first.status || ''}) ${first.error || ''}`.trim(), true);
  let page1;
  try { page1 = JSON.parse(first.text); }
  catch { return loadStatus('CNY ตอบกลับไม่ใช่ JSON (อาจโดน block)', true); }

  let promoResponse = page1;
  if (token) {
    const pr = await proxyFetch(GET_PROMOTION, { headers: { Authorization: `Bearer ${token}` } });
    if (pr.ok) { try { promoResponse = JSON.parse(pr.text); } catch { /* fall back */ } }
    else loadStatus('token ใช้ไม่ได้ — ใช้ชุดโปรสาธารณะแทน');
  }
  const promoMap = extractPromotions(promoResponse);

  const rawPages = await fetchAllCatalogPages(page1);
  const flats = flattenCnyPages(rawPages);
  const promoProducts = buildPromoProducts(flats, promoMap);

  lastSourceLabel = token ? 'โปรโมชัน (ชุดเต็ม)' : 'โปรโมชัน';
  applyProducts(promoProducts);
  loadStatus(`โหลดโปรโมชัน ${promoProducts.length} รายการ${token ? ' (ชุดเต็ม)' : ' (ชุดสาธารณะ)'}`);
}

async function loadCny() {
  const theme = $('#cny-theme').value;
  loadStatus('กำลังโหลดหน้าแรกจาก CNY…');

  const first = await proxyFetch(cnyPageUrl(1, 100));
  if (!first.ok) return loadStatus(`โหลดไม่สำเร็จ (${first.status || ''}) ${first.error || ''}`.trim(), true);
  let page1;
  try { page1 = JSON.parse(first.text); }
  catch { return loadStatus('CNY ตอบกลับไม่ใช่ JSON (อาจโดน block)', true); }

  const rawPages = await fetchAllCatalogPages(page1);
  const all = flattenCnyPages(rawPages)
    .map(cnyToProduct)
    .filter((p) => p.code && p.name && /^https:\/\//i.test(p.imageUrl));

  const filtered = theme && theme !== 'all' ? filterCny(all, { theme }) : all;
  lastSourceLabel = `แคตตาล็อก${theme !== 'all' ? ` (${theme})` : ''}`;
  applyProducts(filtered);
  loadStatus(`โหลดแคตตาล็อก ${filtered.length} รายการ${theme !== 'all' ? ` (หมวด ${theme})` : ''} จากทั้งหมด ${all.length}`);
}

async function fetchAllCatalogPages(page1) {
  const perPage = (page1.product || []).length || 100;
  const total = page1.paginate?.total || perPage;
  const pages = Math.max(1, Math.ceil(total / perPage));

  const rawPages = [page1];
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);

  const CONC = 6;
  let done = 1;
  for (let i = 0; i < rest.length; i += CONC) {
    const batch = rest.slice(i, i + CONC);
    const results = await Promise.all(batch.map((p) => proxyFetch(cnyPageUrl(p, 100))));
    for (const r of results) {
      if (r.ok) { try { rawPages.push(JSON.parse(r.text)); } catch { /* skip bad page */ } }
    }
    done = Math.min(done + batch.length, pages);
    loadStatus(`โหลด ${done}/${pages} หน้า…`);
  }
  return rawPages;
}

async function loadSheet() {
  const url = $('#sheet-url').value.trim();
  const name = $('#sheet-name').value.trim();
  if (!url) return loadStatus('กรุณากรอกลิงก์ Sheet หรือ Spreadsheet ID', true);

  let csvUrl;
  try { csvUrl = sheetCsvUrl(url, name); }
  catch (e) { return loadStatus(e.message, true); }

  loadStatus('กำลังโหลดจาก Google Sheet…');
  const res = await proxyFetch(csvUrl);
  if (!res.ok) return loadStatus(`โหลดไม่สำเร็จ (${res.status || ''}) ${res.error || ''}`.trim(), true);

  try { lastSourceLabel = 'Google Sheet'; applyProducts(normalizeFromCsv(res.text), url, name); }
  catch (e) { loadStatus('แปลง CSV ไม่สำเร็จ: ' + e.message, true); }
}

async function loadJsonUrl() {
  const url = $('#json-url').value.trim();
  if (!url) return loadStatus('กรุณากรอก JSON URL', true);

  loadStatus('กำลังโหลด JSON…');
  const res = await proxyFetch(url);
  if (!res.ok) return loadStatus(`โหลดไม่สำเร็จ (${res.status || ''}) ${res.error || ''}`.trim(), true);

  try {
    const data = JSON.parse(res.text);
    const list = isCnyPayload(data) ? normalizeFromCny(data) : normalizeFromJson(data);
    lastSourceLabel = 'JSON URL';
    applyProducts(list, null, null, { jsonUrl: url });
  } catch (e) {
    loadStatus('แปลง JSON ไม่สำเร็จ: ' + e.message, true);
  }
}

function loadJsonFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      lastSourceLabel = 'JSON ไฟล์';
      applyProducts(isCnyPayload(data) ? normalizeFromCny(data) : normalizeFromJson(data));
    } catch (err) {
      loadStatus('อ่านไฟล์ไม่สำเร็จ: ' + err.message, true);
    }
  };
  reader.onerror = () => loadStatus('อ่านไฟล์ไม่สำเร็จ', true);
  reader.readAsText(file);
}

function applyProducts(list, sheetUrl, sheetName, extra = {}) {
  products = list;
  page = 1;
  presetByCode.clear();
  selectedCodes.clear();
  for (const p of products) presetByCode.set(p.code, p.promoType);

  if (sheetUrl !== undefined && sheetUrl !== null) save({ sheetUrl, sheetName });
  if (extra.jsonUrl) save({ jsonUrl: extra.jsonUrl });

  // cache the (slow-to-fetch) product list so reopening the panel is instant
  save({ cachedProducts: { products, label: lastSourceLabel, fetchedAt: Date.now() } });

  renderList();
  baseChanged();
}

// ---- product controls -----------------------------------------------------
function bindProductControls() {
  // debounced: typing into a 6k-product list re-renders at most every 150ms
  $('#search').addEventListener('input', debounce((e) => { search = e.target.value.trim().toLowerCase(); page = 1; renderList(); }, 150));
  $('#select-all').addEventListener('click', () => {
    pageProducts().forEach((p) => selectedCodes.add(p.code));
    renderList(); baseChanged();
  });
  $('#clear-all').addEventListener('click', () => { selectedCodes.clear(); renderList(); baseChanged(); });
  $('#bulk-preset').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    selectedCodes.forEach((code) => presetByCode.set(code, v));
    e.target.value = '';
    renderList(); baseChanged();
  });
  $('#sort-by').addEventListener('change', (e) => { sortBy = e.target.value; page = 1; renderList(); });
  $('#view-grid').addEventListener('click', () => setView('grid'));
  $('#view-list').addEventListener('click', () => setView('list'));
  $('#filter-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.fchip');
    if (!c) return;
    pFilter = c.dataset.pfilter;
    $$('.fchip').forEach((x) => x.classList.toggle('active', x === c));
    page = 1; renderList();
  });
  bindPresetManager();
}

// ---- custom preset manager (⚙️) -------------------------------------------
function bindPresetManager() {
  $('#preset-manage').addEventListener('click', () => $('#preset-editor').classList.toggle('hidden'));
  $('#np-add').addEventListener('click', () => {
    const label = $('#np-label').value.trim();
    const badgeText = $('#np-badge').value.trim() || label;
    if (!label) return;
    customPresets.push({ id: `c_${Date.now()}`, label, badgeText, badgeColor: $('#np-color').value });
    $('#np-label').value = ''; $('#np-badge').value = '';
    save({ customPresets });
    renderCustomPresets(); refreshPresetSelects(); renderList();
  });
  renderCustomPresets();
}

function renderCustomPresets() {
  const host = $('#preset-custom-list');
  host.textContent = '';
  if (!customPresets.length) { host.appendChild(empty('ยังไม่มี preset กำหนดเอง')); return; }
  for (const c of customPresets) {
    const row = el('div', 'cpreset-row');
    const chip = el('span', 'cpreset-chip');
    chip.textContent = c.badgeText; chip.style.background = c.badgeColor;
    const name = el('span'); name.textContent = c.label;
    const del = el('button', 'btn-ghost sm'); del.textContent = '✕';
    del.addEventListener('click', () => {
      customPresets = customPresets.filter((x) => x.id !== c.id);
      save({ customPresets });
      renderCustomPresets(); refreshPresetSelects(); renderList();
    });
    row.append(chip, name, del);
    host.appendChild(row);
  }
}

// repopulate the bulk-preset dropdown after custom presets change
function refreshPresetSelects() {
  const bulk = $('#bulk-preset');
  const keep = bulk.firstElementChild; // "preset…" placeholder
  bulk.textContent = ''; bulk.appendChild(keep);
  for (const [v, l] of presetOptions()) { const o = el('option'); o.value = v; o.textContent = l; bulk.appendChild(o); }
}

function setView(mode) {
  viewMode = mode;
  $('#view-grid').classList.toggle('active', mode === 'grid');
  $('#view-list').classList.toggle('active', mode === 'list');
  renderList();
}

function visibleProducts() {
  let list = !search ? products : products.filter((p) =>
    p.code.toLowerCase().includes(search) || p.name.toLowerCase().includes(search));
  if (pFilter === 'discount') {
    list = list.filter((p) => p._promo && p._promo.type !== 'giveaway' && p.priceSale != null);
  } else if (pFilter === 'giveaway') {
    list = list.filter((p) => (p._promo && p._promo.type === 'giveaway') || /แถม/.test(p.note || ''));
  }
  if (sortBy === 'discount') {
    list = [...list].sort((a, b) => discountPct(b) - discountPct(a));
  } else if (sortBy === 'expiry') {
    list = [...list].sort((a, b) => (expiryTs(a) ?? Infinity) - (expiryTs(b) ?? Infinity));
  }
  return list;
}

// Campaign end (`end_pro`) as a timestamp, or null when the promo has no expiry.
function expiryTs(p) {
  const raw = p._promo && p._promo.endsAt;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

// Hard Rule 5: surface expiring/expired promos before they get rendered.
function expiryInfo(p) {
  const t = expiryTs(p);
  if (t == null) return null;
  const days = Math.floor((t - Date.now()) / 86400000);
  if (days < 0) return { expired: true, label: '⏰ โปรหมดอายุ' };
  if (days <= 3) return { expired: false, label: days === 0 ? '⏰ หมดวันนี้' : `⏰ เหลือ ${days} วัน` };
  return null;
}

// The slice of the filtered list shown on the current page.
function pageProducts() {
  const list = visibleProducts();
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  if (page > pages) page = pages;
  return list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
}

function renderList() {
  const host = $('#product-list');
  host.classList.toggle('grid', viewMode === 'grid');
  host.classList.toggle('list', viewMode === 'list');
  host.textContent = '';

  const list = visibleProducts();
  $('#result-count').textContent = `พบ ${list.length} รายการ`;

  if (products.length === 0) { host.appendChild(empty('ยังไม่มีข้อมูล — โหลดจากแหล่งด้านบนก่อน')); updateCount(); renderPager(0); return; }
  if (list.length === 0) { host.appendChild(empty('ไม่พบสินค้าตามคำค้น')); updateCount(); renderPager(0); return; }

  for (const p of pageProducts()) host.appendChild(productCard(p));
  updateCount();
  renderPager(list.length);
}

// Page controls under the list: ‹ ก่อนหน้า · หน้า X/Y · ถัดไป ›
function renderPager(total) {
  const pagerHost = $('#product-pager');
  if (!pagerHost) return;
  pagerHost.textContent = '';
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (total <= PER_PAGE) return; // single page — no controls needed

  const mk = (label, target, disabled) => {
    const b = el('button', 'btn-ghost sm');
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', () => {
      page = target;
      renderList();
      $('#products-card')?.scrollIntoView({ block: 'start' });
    });
    return b;
  };
  pagerHost.appendChild(mk('‹ ก่อนหน้า', page - 1, page <= 1));
  const info = el('span', 'pager-info');
  info.textContent = `หน้า ${page} / ${pages}`;
  pagerHost.appendChild(info);
  pagerHost.appendChild(mk('ถัดไป ›', page + 1, page >= pages));
}

function productCard(p) {
  const card = el('div', 'pcard' + (selectedCodes.has(p.code) ? ' selected' : ''));

  const cb = el('input', 'pcheck');
  cb.type = 'checkbox';
  cb.checked = selectedCodes.has(p.code);
  cb.addEventListener('change', () => {
    if (cb.checked) selectedCodes.add(p.code); else selectedCodes.delete(p.code);
    card.classList.toggle('selected', cb.checked);
    updateCount(); baseChanged();
  });

  const imgWrap = el('div', 'pimg');
  const img = el('img');
  img.src = p.imageUrl; img.loading = 'lazy'; img.alt = '';
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  imgWrap.appendChild(img);
  const editBtn = el('button', 'pimg-edit');
  editBtn.type = 'button'; editBtn.textContent = '📷';
  editBtn.title = 'เปลี่ยนรูปจากเครื่อง';
  editBtn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); pickLocalImage(p, img, card); });
  imgWrap.appendChild(editBtn);
  if (p._localImage) card.classList.add('has-local-img');

  const info = el('div', 'pinfo');
  const code = el('div', 'pcode'); code.textContent = `รหัสสินค้า ${p.code}`;
  const name = el('div', 'pname'); name.textContent = p.name;
  info.append(code, name);

  const preset = el('select', 'ppreset');
  for (const [v, l] of presetOptions()) { const o = el('option'); o.value = v; o.textContent = l; preset.appendChild(o); }
  preset.value = presetByCode.get(p.code) || 'custom';
  preset.addEventListener('change', () => { presetByCode.set(p.code, preset.value); baseChanged(); });

  card.append(cb, imgWrap);
  const pct = discountPct(p);
  if (pct) {
    const disc = el('div', 'pdisc');
    disc.textContent = `-${pct}%`;
    card.appendChild(disc);
  }
  const exp = expiryInfo(p);
  if (exp) {
    const chip = el('div', 'pexp' + (exp.expired ? ' expired' : ''));
    chip.textContent = exp.label;
    card.appendChild(chip);
  }
  if (p.badgeText) {
    const badge = el('div', 'pbadge');
    badge.textContent = p.badgeText;
    if (p.badgeColor) badge.style.background = p.badgeColor;
    card.appendChild(badge);
  }
  card.appendChild(info);
  if (p.note) {
    const promo = el('div', 'ppromo');
    promo.textContent = p.note;
    card.appendChild(promo);
  }
  card.appendChild(priceBlock(p));
  card.appendChild(preset);
  return card;
}

function priceBlock(p) {
  const d = el('div', 'pprice');
  const unit = p.unitText ? ` / ${p.unitText}` : '';
  if (p.priceSale != null && p.priceNormal != null) {
    // Sale price is the hero (big red); normal price is small + struck through.
    const was = el('div', 'was'); was.textContent = `฿${money(p.priceNormal)}`;
    const now = el('div', 'now'); now.textContent = `฿${money(p.priceSale)}${unit}`;
    d.append(was, now);
  } else if (p.priceNormal != null) {
    const base = el('div', 'base'); base.textContent = `฿${money(p.priceNormal)}${unit}`;
    d.append(base);
  } else {
    const base = el('div', 'base'); base.textContent = '—'; d.append(base);
  }
  return d;
}

// Discount percent for the corner chip — from explicit percent promos when
// available, else derived from normal vs sale price. Returns 0 when N/A.
function discountPct(p) {
  if (p._promo && p._promo.type === 'percent' && p._promo.discount > 0) {
    return Math.round(p._promo.discount);
  }
  if (p.priceSale != null && p.priceNormal > 0 && p.priceSale < p.priceNormal) {
    return Math.round((1 - p.priceSale / p.priceNormal) * 100);
  }
  return 0;
}

// Replace a product's image with a local file (data URL). Works for the in-app
// preview and the composite banner; a data: URL is NOT a public URL, so real
// LINE Flex delivery needs it hosted first (flagged in renderValidation).
function pickLocalImage(p, imgEl, card) {
  const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (p._origImageUrl === undefined) p._origImageUrl = p.imageUrl;
      p.imageUrl = String(reader.result);
      p._localImage = true;
      imgEl.src = p.imageUrl; imgEl.style.visibility = '';
      card.classList.add('has-local-img');
      baseChanged();
    };
    reader.readAsDataURL(f);
  });
  inp.click();
}

function updateCount() {
  $('#selected-count').textContent = `(${selectedCodes.size} เลือก)`;
  // pill on the สินค้า tab so the selection is visible from every page
  const pill = $('#tab-selected');
  if (pill) {
    pill.textContent = String(selectedCodes.size);
    pill.classList.toggle('hidden', selectedCodes.size === 0);
  }
}

// ---- payload (auto-built or AI-edited) ------------------------------------
function selectedProducts() {
  return products
    .filter((p) => selectedCodes.has(p.code))
    .map((p) => {
      const pr = presetByCode.get(p.code) || p.promoType;
      const c = customPresets.find((x) => x.id === pr);
      // custom preset -> 'custom' template slot + its own badge text/color
      if (c) return { ...p, promoType: 'custom', badgeText: c.badgeText || c.label, badgeColor: c.badgeColor || '#E8000D' };
      return { ...p, promoType: pr };
    });
}

function autoPayload() {
  const sel = selectedProducts();
  if (!sel.length) return null;
  const alt = $('#alt-text').value.trim() || 'โปรโมชั่นสินค้า';
  const tmpl = $('#flex-template') ? $('#flex-template').value : 'classic';
  const messages = buildCarousels(sel, { template: tmpl }).map((c) => buildFlexMessage(c, alt));
  return messages.length === 1 ? messages[0] : messages;
}

function currentPayload() {
  return aiOverride || autoPayload();
}

// product selection/preset changed -> the AI edit no longer applies
function baseChanged() {
  aiOverride = null;
  rebuild();
}

function rebuild() {
  const payload = currentPayload();
  const carousels = payloadToCarousels(payload);
  renderPreview(carousels);
  renderValidation(carousels);
  $('#json-output').value = payload ? JSON.stringify(payload) : ''; // minified for export
}

function payloadToCarousels(payload) {
  if (!payload) return [];
  const msgs = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const m of msgs) {
    const c = m?.contents;
    if (!c) continue;
    if (c.type === 'carousel') out.push(c);
    else if (c.type === 'bubble') out.push({ type: 'carousel', contents: [c] });
  }
  return out;
}

// ---- preview --------------------------------------------------------------
function renderPreview(carousels) {
  const host = $('#preview');
  host.textContent = '';
  if (!carousels.length) { host.appendChild(empty('เลือกสินค้าเพื่อดูพรีวิว')); return; }
  carousels.forEach((carousel, idx) => {
    if (carousels.length > 1) {
      const label = el('div', 'carousel-label');
      label.textContent = `Carousel ${idx + 1} (${carousel.contents.length} bubble)`;
      host.appendChild(label);
    }
    const strip = el('div', 'preview');
    (carousel.contents || []).forEach((b) => strip.appendChild(renderBubble(b)));
    host.appendChild(strip);
  });
}

const SPACING = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
function sizePx(v) {
  if (v == null) return '0';
  const s = String(v);
  if (s.endsWith('px') || s.endsWith('%')) return s;
  if (s in SPACING) return SPACING[s] + 'px';
  const n = Number(s);
  return Number.isFinite(n) ? n + 'px' : '0';
}
function cssGradient(g) {
  const angle = g.angle || '0deg'; // LINE & CSS agree: 0deg = bottom→top, 90deg = left→right
  if (g.centerColor) {
    return `linear-gradient(${angle}, ${g.startColor} 0%, ${g.centerColor} ${g.centerPosition || '50%'}, ${g.endColor} 100%)`;
  }
  return `linear-gradient(${angle}, ${g.startColor || '#000'}, ${g.endColor || '#fff'})`;
}
function applyBoxStyle(d, box) {
  if (!box) return;
  if (box.backgroundColor) d.style.background = box.backgroundColor;
  if (box.background?.type === 'linearGradient') d.style.background = cssGradient(box.background);
  if (box.cornerRadius) d.style.borderRadius = sizePx(box.cornerRadius);
  if (box.paddingAll) d.style.padding = sizePx(box.paddingAll);
  if (box.borderWidth) d.style.border = `${sizePx(box.borderWidth)} solid ${box.borderColor || '#000'}`;
}

function renderBubble(bubble) {
  const card = el('div', 'bubble');
  if (bubble.header) {
    const h = el('div', 'body'); applyBoxStyle(h, bubble.header);
    (bubble.header.contents || []).forEach((c) => h.appendChild(renderComponent(c)));
    card.appendChild(h);
  }
  if (bubble.hero) card.appendChild(renderComponent(bubble.hero));
  if (bubble.body) {
    const body = el('div', 'body'); applyBoxStyle(body, bubble.body);
    (bubble.body.contents || []).forEach((c) => body.appendChild(renderComponent(c)));
    card.appendChild(body);
  }
  if (bubble.footer) {
    const footer = el('div', 'footer'); applyBoxStyle(footer, bubble.footer);
    (bubble.footer.contents || []).forEach((c) => footer.appendChild(renderComponent(c)));
    card.appendChild(footer);
  }
  return card;
}

function renderComponent(c) {
  if (!c || typeof c !== 'object') return document.createTextNode('');
  if (c.type === 'image') {
    const img = el('img', 'hero');
    img.src = c.url; img.loading = 'lazy'; img.alt = '';
    if (c.aspectMode === 'fit') img.style.objectFit = 'contain';
    img.addEventListener('error', () => { img.style.background = '#fbe6e6'; });
    return img;
  }
  if (c.type === 'text') {
    const d = el('div', 't');
    d.textContent = c.text;
    d.style.fontSize = (SIZE_PX[c.size] || 13) + 'px';
    if (c.color) d.style.color = c.color;
    if (c.weight === 'bold') d.style.fontWeight = '700';
    if (c.decoration === 'line-through') d.style.textDecoration = 'line-through';
    if (c.align) d.style.textAlign = c.align;
    if (c.margin) d.style.marginTop = sizePx(c.margin);
    d.style.whiteSpace = c.wrap ? 'normal' : 'nowrap';
    if (!c.wrap) { d.style.overflow = 'hidden'; d.style.textOverflow = 'ellipsis'; }
    return d;
  }
  if (c.type === 'box') {
    const d = el('div');
    const horizontal = c.layout === 'horizontal' || c.layout === 'baseline';
    d.style.display = 'flex';
    d.style.flexDirection = horizontal ? 'row' : 'column';
    if (horizontal) { d.style.gap = '4px'; d.style.alignItems = c.layout === 'baseline' ? 'baseline' : 'center'; }
    if (c.justifyContent) d.style.justifyContent = c.justifyContent;
    if (c.alignItems) d.style.alignItems = c.alignItems;
    if (c.margin) d.style.marginTop = sizePx(c.margin);
    applyBoxStyle(d, c);
    (c.contents || []).forEach((ch) => d.appendChild(renderComponent(ch)));
    return d;
  }
  if (c.type === 'button') {
    const b = el('button', 'btn');
    b.textContent = c.action?.label || '';
    if (c.margin) b.style.marginTop = sizePx(c.margin);
    if (c.style === 'secondary') { b.style.background = c.color || '#eee'; b.style.color = '#333'; }
    else if (c.style === 'link') { b.style.background = 'transparent'; b.style.color = c.color || '#1f6feb'; }
    else if (c.color) b.style.background = c.color;
    b.disabled = true;
    return b;
  }
  if (c.type === 'separator') {
    const s = el('div'); s.style.borderTop = `1px solid ${c.color || '#eee'}`; s.style.margin = `${sizePx(c.margin || 'sm')} 0`;
    return s;
  }
  return document.createTextNode('');
}

// ---- validation -----------------------------------------------------------
function renderValidation(carousels) {
  const host = $('#validation');
  host.textContent = '';
  if (!carousels.length) return;

  const results = carousels.map(validate);
  const totalBubbles = carousels.reduce((s, c) => s + (c.contents?.length || 0), 0);
  const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
  const allErrors = results.flatMap((r, i) => r.errors.map((e) => tagMsg(carousels.length, i, e)));
  const allWarnings = results.flatMap((r, i) => r.warnings.map((w) => tagMsg(carousels.length, i, w)));

  host.appendChild(pill(`${totalBubbles} bubble`, allErrors.length ? 'err' : 'ok'));
  if (carousels.length > 1) host.appendChild(pill(`${carousels.length} carousels`, 'warn'));
  if (aiOverride) host.appendChild(pill('AI edited', 'warn'));
  host.appendChild(pill(`${fmtBytes(totalBytes)}`, totalBytes > 50 * 1024 ? 'err' : 'ok'));

  for (const e of allErrors) host.appendChild(msgEl(e, 'err'));
  for (const w of allWarnings) host.appendChild(msgEl(w, 'warn'));

  // Local-image caveat: data: URLs render in preview/banner but LINE fetches
  // hero images server-side, so they won't show in a real broadcast until hosted.
  const localCount = selectedProducts().filter((p) => /^data:/.test(p.imageUrl || '')).length;
  if (localCount) {
    host.appendChild(pill(`${localCount} รูปจากเครื่อง`, 'warn'));
    host.appendChild(msgEl('รูปจากเครื่องใช้ในพรีวิว/แบนเนอร์ได้ แต่ส่ง LINE จริงต้องอัปโหลดขึ้น host (HTTPS) ก่อน — แบนเนอร์ดาวน์โหลด PNG ได้ตามปกติ', 'warn'));
  }
}

function tagMsg(count, i, text) { return count > 1 ? `[C${i + 1}] ${text}` : text; }
function pill(text, kind) { const s = el('span', `pill ${kind || ''}`); s.textContent = text; return s; }
function msgEl(text, kind) { const s = el('span', `msg ${kind}`); s.textContent = (kind === 'err' ? '✗ ' : '⚠ ') + text; return s; }

// ---- export ---------------------------------------------------------------
function bindExport() {
  $('#alt-text').addEventListener('input', () => { if (!aiOverride) rebuild(); });
  $('#flex-template')?.addEventListener('change', () => { aiOverride = null; rebuild(); });
  $('#copy-json').addEventListener('click', copyJson);
  $('#download-json').addEventListener('click', downloadJson);
  $('#open-sim').addEventListener('click', openSimulator);
}

// Open LINE's official Flex Simulator (ground truth) with the JSON on the clipboard.
async function openSimulator() {
  const payload = currentPayload();
  if (!payload) return exportStatus('ยังไม่มี flex ให้เช็ค', true);
  try { await navigator.clipboard.writeText(JSON.stringify(payload)); } catch { /* ignore */ }
  const url = 'https://developers.line.biz/flex-simulator/';
  if (chrome.tabs?.create) chrome.tabs.create({ url }); else window.open(url, '_blank');
  exportStatus('คัดลอก JSON + เปิด Simulator แล้ว — กด “Show JSON” แล้ววาง (Ctrl+V)');
}

async function copyJson() {
  const payload = currentPayload();
  if (!payload) return exportStatus('ยังไม่มีอะไรให้คัดลอก', true);
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));
    exportStatus('คัดลอก JSON (minified) แล้ว');
  } catch {
    exportStatus('คัดลอกไม่สำเร็จ — เลือกข้อความในกล่องแล้วคัดลอกเอง', true);
  }
}

function downloadJson() {
  const payload = currentPayload();
  if (!payload) return exportStatus('ยังไม่มีอะไรให้ดาวน์โหลด', true);
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url; a.download = 'flex-promo.json';
  a.click();
  URL.revokeObjectURL(url);
  exportStatus('ดาวน์โหลดแล้ว');
}

// ---- AI chat --------------------------------------------------------------
// ---- separate chat window (chatBus relay; contract in desktop/main.js) ----
function sendChatContext() {
  if (!window.chatBus) return;
  const payload = currentPayload();
  const sel = selectedProducts();
  window.chatBus.send('chat', 'context', {
    flexJson: payload ? JSON.stringify(payload) : null,
    productsSummary: sel.length
      ? `${sel.length} สินค้า: ${sel.slice(0, 3).map((p) => p.name).join(', ')}${sel.length > 3 ? '…' : ''}`
      : 'ยังไม่เลือกสินค้า',
    backend: {
      kind: $('#ai-backend').value === 'bridge' ? 'bridge' : 'api',
      bridgeUrl: $('#bridge-url').value.trim(),
      apiKey: $('#api-key').value.trim(),
    },
  });
}

function bindChatWindow() {
  $('#open-chat-window').addEventListener('click', async () => {
    if (!window.chatBus) return chatStatus('หน้าต่างแชทใช้ได้ในแอปเดสก์ท็อปเท่านั้น', true);
    await window.chatBus.open();
    sendChatContext();
  });
  if (!window.chatBus) return;
  window.chatBus.on(({ type, data }) => {
    if (type === 'chat-ready') {
      sendChatContext();
    } else if (type === 'apply-flex') {
      try {
        aiOverride = data.flex;
        rebuild();
        window.chatBus.send('chat', 'applied', { ok: true });
      } catch {
        window.chatBus.send('chat', 'applied', { ok: false });
      }
    }
  });
}

function bindChat() {
  bindChatWindow();
  $('#ai-backend').addEventListener('change', () => {
    applyBackendUi();
    save({ aiBackend: $('#ai-backend').value });
  });
  $('#save-key').addEventListener('click', () => {
    save({
      anthropicKey: $('#api-key').value.trim(),
      bridgeUrl: $('#bridge-url').value.trim(),
      aiBackend: $('#ai-backend').value,
    });
    chatStatus('บันทึกแล้ว');
  });
  $('#test-conn').addEventListener('click', testConnection);
  $('#chat-send').addEventListener('click', sendChat);
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $('#chat-reset').addEventListener('click', () => {
    if (!aiOverride) return chatStatus('ยังไม่มีการแก้ด้วย AI');
    aiOverride = null;
    rebuild();
    chatStatus('กลับไปดีไซน์อัตโนมัติแล้ว');
  });
}

function applyBackendUi() {
  const b = $('#ai-backend').value;
  $('#bridge-row').classList.toggle('hidden', b !== 'bridge');
  $('#apikey-row').classList.toggle('hidden', b !== 'api');
}

async function testConnection() {
  if ($('#ai-backend').value === 'bridge') {
    const base = ($('#bridge-url').value.trim() || 'http://127.0.0.1:8765').replace(/\/+$/, '');
    chatStatus('กำลังทดสอบ bridge…');
    const res = await proxyFetch(`${base}/ping`);
    if (res.ok) return chatStatus('✅ bridge ทำงานอยู่ — สั่งแชทได้เลย (จะเรียก claude -p ให้)');
    return chatStatus('❌ ต่อ bridge ไม่ได้ — รัน "node bridge/server.cjs" ในโฟลเดอร์ extension ก่อน แล้วเปิดค้างไว้', true);
  }

  const key = $('#api-key').value.trim();
  if (!key) return chatStatus('ใส่ Anthropic API key / OAuth token ก่อน', true);
  const isOat = /^sk-ant-oat/i.test(key);
  const kind = isOat ? 'OAuth token (Bearer)' : 'API key (x-api-key)';
  chatStatus(`กำลังทดสอบ /v1/messages จริง… ใช้ ${kind}`);

  const req = buildTestRequest(key);
  const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });

  if (res.ok) return chatStatus(`✅ ใช้ได้จริง (HTTP ${res.status}) · ${kind} — สั่งแชทแก้ดีไซน์ได้เลย`);
  if (res.status === 401) {
    const hint = isOat
      ? ' — OAuth token (Claude Code/Pro/Max) ใช้กับ API ปกติไม่ได้ ต้องใช้ API key sk-ant-api03 จาก console.anthropic.com'
      : ' — เช็ค API key sk-ant-api03 ว่าถูกและยัง active';
    return chatStatus(`❌ credential ถูกปฏิเสธ (401)${hint}`, true);
  }
  if (res.status === 403) return chatStatus('❌ 403 — credential ใช้ได้แต่ไม่มีเครดิต (เติม billing ที่ console.anthropic.com)', true);
  if (res.status && res.status > 0) return chatStatus(`⚠️ HTTP ${res.status} ${res.error || ''}`, true);
  return chatStatus('❌ network — reload extension / เช็คเน็ต-ไฟร์วอลล์', true);
}

async function sendChat() {
  const text = $('#chat-input').value.trim();
  if (!text) return;

  const payload = currentPayload();
  if (!payload) return chatStatus('เลือกสินค้าก่อน เพื่อให้มี flex ให้แก้', true);

  const backend = $('#ai-backend').value;
  appendChat('user', text);
  $('#chat-input').value = '';

  const result = backend === 'bridge'
    ? await editViaBridge(payload, text, chatMode)
    : await editViaApi(payload, text, chatMode);
  if (!result) return; // status already set by the helper

  if (chatMode === 'advise') {
    renderAdvice(result.advice || [], result.flex || null, text);
  } else {
    aiOverride = result;
    rebuild();
    appendChat('ai', '✅ แก้ดีไซน์ให้แล้ว — ดูพรีวิวด้านบน');
    chatStatus('');
  }
}

// Render crm-marketer advice + a draft, with apply / redo buttons.
function renderAdvice(advice, flex, instruction) {
  const log = $('#chat-log');
  const card = el('div', 'advice-card');
  const title = el('div'); title.innerHTML = '<b>คำแนะนำจาก crm-marketer</b>';
  card.appendChild(title);
  if (advice.length) {
    const ul = el('ul');
    advice.forEach((a) => { const li = el('li'); li.textContent = a; ul.appendChild(li); });
    card.appendChild(ul);
  }
  const actions = el('div', 'adv-actions');
  if (flex) {
    const applyBtn = el('button', 'adv-apply');
    applyBtn.textContent = '✅ ใช้ดราฟต์นี้';
    applyBtn.addEventListener('click', () => {
      aiOverride = flex; rebuild();
      applyBtn.disabled = true; applyBtn.textContent = 'ใช้แล้ว';
      chatStatus('ใช้ดราฟต์ที่แนะนำแล้ว — ดูพรีวิวด้านบน');
    });
    actions.appendChild(applyBtn);
  }
  const redo = el('button', 'adv-redo');
  redo.textContent = '✏️ แก้คำสั่งใหม่';
  redo.addEventListener('click', () => { $('#chat-input').value = instruction; $('#chat-input').focus(); });
  actions.appendChild(redo);
  card.appendChild(actions);
  log.appendChild(card);
  log.scrollTop = log.scrollHeight;
  chatStatus('');
}

// Claude Code bridge (claude -p) — free, uses the user's Claude Code login.
// Routes through the crm-marketer persona; mode 'apply' | 'advise'.
async function editViaBridge(payload, instruction, mode = 'apply') {
  chatStatus('กำลังให้ Claude Code (crm-marketer) แก้ดีไซน์… (อาจช้าหน่อย)');
  const prompt = buildEditPrompt(JSON.stringify(payload), instruction, mode);
  const req = buildBridgeRunRequest($('#bridge-url').value.trim(), prompt);
  const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) {
    const hint = res.status === 0 ? ' — รัน "node bridge/server.cjs" แล้วเปิดค้างไว้หรือยัง?' : '';
    chatStatus(`เรียก bridge ไม่สำเร็จ (${res.status || 'network'}) ${res.error || ''}${hint}`.trim(), true);
    return null;
  }
  let data;
  try { data = JSON.parse(res.text); }
  catch { chatStatus('bridge ตอบกลับไม่ใช่ JSON', true); return null; }
  if (!data.ok) { chatStatus('Claude Code error: ' + (data.error || ''), true); return null; }
  try { return parseEditResponse(data.text, mode); }
  catch (e) { appendChat('ai', '(แปลผลไม่สำเร็จ)'); chatStatus('แปลผล: ' + e.message, true); return null; }
}

// Direct Anthropic API (needs an sk-ant-api03 key with billing).
async function editViaApi(payload, instruction, mode = 'apply') {
  const key = $('#api-key').value.trim();
  if (!key) { chatStatus('ใส่ Anthropic API key ก่อน (เลือก backend = API key)', true); return null; }
  chatStatus('กำลังให้ crm-marketer แก้ดีไซน์…');
  const req = buildAiRequest(key, JSON.stringify(payload), instruction, mode);
  const res = await proxyFetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  if (!res.ok) {
    const hint = res.status === 0
      ? ' — reload extension / เช็คเน็ต'
      : res.status === 401 ? ' — key ผิด หรือเป็น OAuth token (ใช้ไม่ได้ — ต้อง sk-ant-api03)' : '';
    chatStatus(`เรียก AI ไม่สำเร็จ (${res.status || 'network'}) ${res.error || ''}${hint}`.trim(), true);
    return null;
  }
  let data;
  try { data = JSON.parse(res.text); }
  catch { chatStatus('AI ตอบกลับไม่ใช่ JSON', true); return null; }
  try { return parseEditResponse(textFromResponse(data), mode); }
  catch (e) { appendChat('ai', '(แปลผลไม่สำเร็จ)'); chatStatus('AI: ' + e.message, true); return null; }
}

// Generic prompt runner via the current backend (bridge /run or API) -> text.
async function runViaBackend(prompt) {
  if ($('#ai-backend').value === 'bridge') {
    const req = buildBridgeRunRequest($('#bridge-url').value.trim(), prompt);
    const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!res.ok) throw new Error(`bridge (${res.status || 'network'}) ${res.error || ''} — รัน server แล้วยัง?`);
    const data = JSON.parse(res.text);
    if (!data.ok) throw new Error(data.error || 'bridge error');
    return data.text;
  }
  const key = $('#api-key').value.trim();
  if (!key) throw new Error('ใส่ Anthropic API key ก่อน (backend = API key)');
  const req = buildAiTextRequest(key, prompt);
  const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) throw new Error(`API (${res.status || 'network'}) ${res.error || ''}`);
  return textFromResponse(JSON.parse(res.text));
}

// ---- image tab -----------------------------------------------------------
function bindImageTab() {
  $('#image-mode-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    $$('#image-mode-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    const m = t.dataset.imgmode;
    $$('.img-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.imgpane !== m));
  });
  $('#gen-composite').addEventListener('click', genComposite);
  $('#gen-ai-image').addEventListener('click', genAiImage);
  $('#cutout-bg').addEventListener('click', cutoutBackground);
  $('#clear-composite-out').addEventListener('click', () => { $('#composite-out').textContent = ''; setStatus('#composite-status', ''); });
  $('#clear-ai-out').addEventListener('click', () => { $('#ai-image-out').textContent = ''; setStatus('#ai-image-status', ''); });
  $('#clear-gwp-out').addEventListener('click', () => { $('#gwp-out').textContent = ''; setStatus('#gwp-status', ''); });
  bindGenModes();
  bindGwp();
  bindFlexD();
  $('#save-img-key').addEventListener('click', () => {
    save({ imgProvider: $('#img-provider').value, imgKey: $('#img-key').value.trim() });
    setStatus('#ai-image-status', 'บันทึก key แล้ว');
  });
  $('#img-provider').addEventListener('change', () => { save({ imgProvider: $('#img-provider').value }); applyImgProviderUi(); });
  bindRefImage();
  bindImageHost();
  bindPromoSettings();
}

function bindPromoSettings() {
  $('#promo-logo').addEventListener('change', () => {
    const f = $('#promo-logo').files && $('#promo-logo').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { promoLogo = String(reader.result); save({ promoLogo }); setStatus('#composite-status', 'ตั้งโลโก้แล้ว'); };
    reader.readAsDataURL(f);
  });
  $('#promo-contact').addEventListener('change', () => save({ promoContact: $('#promo-contact').value }));
  $('#promo-shipfree').addEventListener('change', () => save({ promoShipfree: $('#promo-shipfree').checked }));
}

function bindImageHost() {
  $('#host-provider').addEventListener('change', applyHostProviderUi);
  $('#save-host').addEventListener('click', () => {
    save({
      hostProvider: $('#host-provider').value,
      imgbbKey: $('#imgbb-key').value.trim(),
      cldCloud: $('#cld-cloud').value.trim(),
      cldPreset: $('#cld-preset').value.trim(),
    });
    setStatus('#ai-image-status', 'บันทึกค่าโฮสต์รูปแล้ว');
  });
}

function applyHostProviderUi() {
  const isImgbb = $('#host-provider').value === 'imgbb';
  $('#imgbb-row').classList.toggle('hidden', !isImgbb);
  $('#cld-row').classList.toggle('hidden', isImgbb);
}

// Upload a data URL / base64 image to the configured host -> public HTTPS URL.
async function uploadImage(input, name) {
  const provider = $('#host-provider').value;
  let creds;
  if (provider === 'imgbb') {
    const key = $('#imgbb-key').value.trim();
    if (!key) throw new Error('ใส่ imgbb API key ในตั้งค่าโฮสต์ก่อน');
    creds = { key };
  } else {
    creds = { cloud: $('#cld-cloud').value.trim(), preset: $('#cld-preset').value.trim() };
    if (!creds.cloud || !creds.preset) throw new Error('ใส่ Cloudinary cloud + preset ก่อน');
  }
  const req = buildUploadRequest(provider, creds, input, { name });
  const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) throw new Error(`HTTP ${res.status || 'network'} ${res.error || ''}`.trim());
  let json;
  try { json = JSON.parse(res.text); }
  catch { throw new Error('โฮสต์ตอบกลับไม่ใช่ JSON'); }
  return parseUploadResponse(provider, json);
}

// Append an "upload → URL" control to an image card's footer. getDataUrl()
// returns the image as a data URL; product (optional) lets the URL be set as
// the product's Flex hero image in one click.
// ---- Template D: image-grid Flex from uploaded artwork ---------------------
const uploadedBanners = []; // { url, code } — hosted HTTPS images this session

function updateFlexDBar() {
  const n = uploadedBanners.length;
  const count = $('#flexd-count');
  const btn = $('#make-flex-d');
  if (!count || !btn) return;
  count.textContent = n ? `รูปที่อัปโหลดแล้ว ${n} รูป` : 'อัปโหลดรูป (☁️) แล้วเอามาจัดเป็น Flex ได้ที่นี่';
  btn.disabled = n === 0;
}

function bindFlexD() {
  $('#make-flex-d')?.addEventListener('click', () => {
    if (!uploadedBanners.length) return;
    const alt = $('#alt-text').value.trim() || 'โปรโมชั่นสินค้า';
    // full-bleed 1:1 image bubbles, 12 per carousel (LINE limit)
    const bubbles = uploadedBanners.map((b) => ({
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '0px',
        contents: [{ type: 'image', url: b.url, size: 'full', aspectMode: 'cover', aspectRatio: '1:1' }],
      },
    }));
    const messages = [];
    for (let i = 0; i < bubbles.length; i += 12) {
      messages.push({
        type: 'flex', altText: alt,
        contents: { type: 'carousel', contents: bubbles.slice(i, i + 12) },
      });
    }
    aiOverride = messages.length === 1 ? messages[0] : messages;
    rebuild();
    setStatus('#flexd-status', `จัด Flex จาก ${uploadedBanners.length} รูปแล้ว — ดู/ส่งออกได้ที่แท็บ 🎨 ดีไซน์ Flex`);
    document.querySelector('.maintab[data-mainpane="flex"]')?.click();
  });
}

// ---- Template C: partner / GWP card ---------------------------------------
let gwpPhoto = null; // data URL of the gift photo

function bindGwp() {
  $('#gwp-photo').addEventListener('change', () => {
    const f = $('#gwp-photo').files && $('#gwp-photo').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { gwpPhoto = String(reader.result); setStatus('#gwp-status', 'ตั้งรูปของแถมแล้ว'); };
    reader.readAsDataURL(f);
  });
  $('#gwp-photo-from-product').addEventListener('click', async () => {
    const sel = selectedProducts();
    if (!sel.length) return setStatus('#gwp-status', 'เลือกสินค้าก่อน (ที่แท็บ สินค้า)', true);
    setStatus('#gwp-status', 'กำลังดึงรูปสินค้า…');
    const d = await fetchImageData(sel[0].imageUrl);
    if (!d) return setStatus('#gwp-status', 'ดึงรูปไม่สำเร็จ', true);
    gwpPhoto = `data:${d.mime};base64,${d.base64}`;
    setStatus('#gwp-status', `ใช้รูปของ ${sel[0].code} เป็นรูปของแถมแล้ว`);
  });
  $('#gwp-prefill').addEventListener('click', gwpPrefill);
  $('#gen-gwp').addEventListener('click', genGwpCard);
}

// Prefill the form from a selected product that carries a giveaway campaign
// (campaignText like "แถม สินค้า SKU 6645 ดีเดย์ ฟิชออย … 1 กล่อง").
function gwpPrefill() {
  const sel = selectedProducts();
  const gw = sel.find((p) => p._promo && p._promo.type === 'giveaway') || sel.find((p) => p.note);
  if (!gw) return setStatus('#gwp-status', 'ไม่พบโปรของแถมในสินค้าที่เลือก — เลือกสินค้าที่มีป้าย 🎁 ก่อน', true);
  const note = gw.note || '';
  $('#gwp-title').value = $('#gwp-title').value || (gw._promo && gw._promo.campaignName) || `โปรของแถม — ${gw.name}`;
  $('#gwp-buy').value = $('#gwp-buy').value || `ซื้อ ${gw.name}`;
  $('#gwp-gift').value = $('#gwp-gift').value || note.replace(/^แถม\s*(สินค้า)?\s*/, '').trim();
  const skuM = /SKU\s*(\d+)/i.exec(note);
  if (skuM && !$('#gwp-sku').value) $('#gwp-sku').value = skuM[1];
  if (gw._promo && gw._promo.endsAt && !$('#gwp-period').value) {
    $('#gwp-period').value = `วันนี้ – ${gw._promo.endsAt}`;
  }
  setStatus('#gwp-status', 'เติมข้อมูลจากโปรของแถมแล้ว — ตรวจ/แก้ได้ก่อนสร้าง');
}

async function genGwpCard() {
  if (typeof window.cardRender !== 'function') return setStatus('#gwp-status', 'ฟีเจอร์นี้ใช้ได้ในแอปเดสก์ท็อป', true);
  const title = $('#gwp-title').value.trim();
  const buy = $('#gwp-buy').value.trim();
  const gift = $('#gwp-gift').value.trim();
  if (!title || !buy || !gift) return setStatus('#gwp-status', 'กรอกอย่างน้อย: ชื่อแคมเปญ + เงื่อนไขซื้อ + ของแถม', true);
  const rec = {
    title,
    brands: $('#gwp-brands').value.trim(),
    buy_text: buy,
    gift_text: gift,
    gift_photo: gwpPhoto || '',
    gift_sku: $('#gwp-sku').value.trim(),
    qty_text: $('#gwp-qty').value.trim(),
    period_text: $('#gwp-period').value.trim(),
  };
  setStatus('#gwp-status', 'กำลังสร้างการ์ด GWP…');
  let res;
  try { res = await window.cardRender(rec, { template: 'c' }); }
  catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
  if (!res || !res.ok) return setStatus('#gwp-status', 'สร้างไม่สำเร็จ' + (res && res.error ? `: ${res.error}` : ''), true);
  const out = $('#gwp-out');
  const card = el('div', 'banner-card');
  const img = el('img'); img.src = res.dataUrl; card.appendChild(img);
  const foot = el('div', 'bc-foot');
  const dl = el('a'); dl.textContent = 'ดาวน์โหลด'; dl.download = 'gwp-card.png'; dl.href = res.dataUrl;
  foot.appendChild(dl);
  attachUpload(foot, () => res.dataUrl, null);
  card.appendChild(foot);
  out.prepend(card);
  setStatus('#gwp-status', 'สร้างการ์ด GWP เสร็จ');
}

function attachUpload(foot, getDataUrl, product) {
  const btn = el('button');
  btn.textContent = '☁️ อัปโหลด→URL';
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'กำลังอัปโหลด…';
    try {
      const url = await uploadImage(getDataUrl(), product && product.code ? `ad-${product.code}` : 'ad');
      btn.remove();
      showUploadedUrl(foot, url, product);
      setStatus('#ai-image-status', 'อัปโหลดเสร็จ — ได้ลิงก์ HTTPS แล้ว');
    } catch (e) {
      btn.disabled = false; btn.textContent = '☁️ อัปโหลด→URL';
      setStatus('#ai-image-status', 'อัปโหลดไม่สำเร็จ: ' + e.message, true);
    }
  });
  foot.appendChild(btn);
}

function showUploadedUrl(foot, url, product) {
  // remember for Template D (image-grid Flex from finished artwork)
  uploadedBanners.push({ url, code: product && product.code ? product.code : '' });
  updateFlexDBar();
  const row = el('div', 'upload-url');
  const inp = el('input'); inp.type = 'text'; inp.readOnly = true; inp.value = url;
  const copy = el('button'); copy.textContent = 'คัดลอก';
  copy.addEventListener('click', () => { navigator.clipboard?.writeText(url); copy.textContent = 'คัดลอกแล้ว'; });
  row.append(inp, copy);
  if (product) {
    const use = el('button'); use.textContent = 'ใช้เป็นรูป Flex';
    use.title = 'ตั้งเป็น hero image ของสินค้านี้ใน Flex';
    use.addEventListener('click', () => {
      product.imageUrl = url;
      product._localImage = false;
      use.textContent = 'ตั้งแล้ว ✓';
      baseChanged();
      renderList();
    });
    row.appendChild(use);
  }
  foot.parentElement.appendChild(row);
}

// Reference image (image-to-image) — attach from a local file or from the
// selected product's image. Stored as { mime, base64 } in `refImage`.
function bindRefImage() {
  $('#ref-pick').addEventListener('click', () => $('#ref-file').click());
  $('#ref-file').addEventListener('change', () => {
    const f = $('#ref-file').files && $('#ref-file').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setRefImage(String(reader.result));
    reader.readAsDataURL(f);
  });
  $('#ref-from-product').addEventListener('click', refFromProduct);
  $('#ref-clear').addEventListener('click', () => { refImage = null; renderRef(null); });
}

async function refFromProduct() {
  const sel = selectedProducts();
  if (!sel.length) return setStatus('#ai-image-status', 'เลือกสินค้าก่อน แล้วกดใช้รูปสินค้าเป็นเรฟ', true);
  const src = sel[0].imageUrl;
  if (!src) return setStatus('#ai-image-status', 'สินค้านี้ไม่มีรูป', true);
  if (src.startsWith('data:')) return setRefImage(src);
  setStatus('#ai-image-status', 'กำลังดึงรูปสินค้ามาเป็นเรฟ…');
  const res = await proxyFetch(src, { binary: true });
  if (!res.ok || !res.base64) return setStatus('#ai-image-status', 'ดึงรูปสินค้าไม่สำเร็จ', true);
  refImage = { mime: res.contentType || 'image/jpeg', base64: res.base64 };
  renderRef(`data:${refImage.mime};base64,${refImage.base64}`);
  setStatus('#ai-image-status', 'ตั้งรูปสินค้าเป็นเรฟแล้ว');
}

// Accept a data: URL string, split into { mime, base64 }, and show the thumb.
function setRefImage(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) return setStatus('#ai-image-status', 'อ่านรูปเรฟไม่สำเร็จ', true);
  refImage = { mime: m[1], base64: m[2] };
  renderRef(dataUrl);
}

function renderRef(dataUrl) {
  const thumb = $('#ref-thumb');
  const clear = $('#ref-clear');
  if (dataUrl) {
    thumb.src = dataUrl; thumb.classList.remove('hidden'); clear.classList.remove('hidden');
  } else {
    thumb.src = ''; thumb.classList.add('hidden'); clear.classList.add('hidden');
    $('#ref-file').value = '';
  }
}

// Preset image prompts. {p} is replaced by the selected product's name (or a
// generic "สินค้า" when nothing is selected). Drug-ad safe: describes the scene
// only, never medical claims.
// ---- prompt builder (promptkit chips) --------------------------------------
function bindGenModes() {
  $('#genmode-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    genMode = t.dataset.genmode;
    $$('#genmode-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    $('#genmode-product-only').classList.toggle('hidden', genMode !== 'product');
    renderPromptKit(); composeKitPrompt();
  });
  $('#img-extra').addEventListener('input', composeKitPrompt);
  renderPromptKit(); composeKitPrompt();
}

function renderPromptKit() {
  const host = $('#promptkit');
  host.textContent = '';
  const sel = kitSel[genMode];
  const cats = genMode === 'product'
    ? ['purpose', 'style', 'theme', 'elements', 'mood']
    : ['theme', 'style', 'elements', 'mood']; // bg mode: theme first, purpose ignored
  for (const cat of cats) {
    const row = el('div', 'kit-row');
    const lab = el('span', 'kit-label'); lab.textContent = KIT_LABEL[cat];
    row.appendChild(lab);
    for (const opt of PROMPT_KIT[cat]) {
      const b = el('button', 'kchip');
      b.type = 'button';
      b.textContent = opt.label;
      const active = cat === 'elements' ? sel.elementIds.includes(opt.id) : sel[KIT_KEY[cat]] === opt.id;
      if (active) b.classList.add('active');
      b.addEventListener('click', () => {
        if (cat === 'elements') {
          const i = sel.elementIds.indexOf(opt.id);
          if (i >= 0) sel.elementIds.splice(i, 1); else sel.elementIds.push(opt.id);
        } else {
          sel[KIT_KEY[cat]] = opt.id;
        }
        renderPromptKit(); composeKitPrompt();
      });
      row.appendChild(b);
    }
    host.appendChild(row);
  }
}

function composeKitPrompt() {
  const sel = kitSel[genMode];
  const p = selectedProducts()[0];
  $('#img-prompt').value = composePrompt({
    mode: genMode,
    ...sel,
    productName: genMode === 'product' && p ? p.name : undefined,
    extra: $('#img-extra').value.trim() || undefined,
  });
}

function applyImgProviderUi() {
  // codex needs no API key
  $('#img-key-row').classList.toggle('hidden', $('#img-provider').value === 'codex');
}

// Composite promo banners (free, in-app canvas) from the selected products.
async function genComposite() {
  const sel = selectedProducts();
  if (!sel.length) return setStatus('#composite-status', 'เลือกสินค้าก่อน', true);
  const expired = sel.filter((p) => expiryInfo(p)?.expired);
  if (expired.length) {
    setStatus('#composite-status',
      `⚠️ โปรหมดอายุแล้ว ${expired.length} รายการ (${expired.map((p) => p.code).join(', ')}) — ตรวจก่อนใช้จริง`, true);
  }
  const size = $('#img-size').value;
  const template = $('#img-template').value;
  const out = $('#composite-out');
  out.textContent = '';
  setStatus('#composite-status', `กำลังสร้าง ${sel.length} แบนเนอร์…`);
  const promoOpts = {
    logoUrl: promoLogo || undefined,
    contact: $('#promo-contact').value.trim() || undefined,
    shipFree: $('#promo-shipfree').checked,
  };
  // promo / cny → production-accurate HTML card (skill templates A/B, rendered
  // to PNG by Chromium); classic / bold stay on the in-page canvas compositor.
  const useCard = (template === 'promo' || template === 'cny') && typeof window.cardRender === 'function';
  let done = 0;
  for (const p of sel) {
    if (useCard) {
      await renderPromoCard(p, template, out);
    } else {
      const plan = buildBanner(p, { size, template, ...promoOpts });
      const card = el('div', 'banner-card');
      const canvas = el('canvas');
      canvas.width = plan.width; canvas.height = plan.height;
      card.appendChild(canvas);
      out.appendChild(card);
      try { await drawPlan(canvas, plan); } catch { /* best-effort */ }
      const foot = el('div', 'bc-foot');
      const dl = el('a');
      dl.textContent = 'ดาวน์โหลด'; dl.download = `promo-${p.code}.png`;
      try { dl.href = canvas.toDataURL('image/png'); } catch { dl.textContent = '(export ไม่ได้)'; }
      foot.appendChild(dl);
      attachUpload(foot, () => canvas.toDataURL('image/png'), p);
      card.appendChild(foot);
    }
    done++;
    setStatus('#composite-status', `เสร็จ ${done}/${sel.length}`);
  }
  setStatus('#composite-status', `สร้างเสร็จ ${done} แบนเนอร์`);
}

// Drop the white studio background from a product shot so it sits naturally on
// themed/AI cards. Skips photos that aren't white-background. PNG keeps alpha.
function cutoutPhotoDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => {
      try {
        const c = el('canvas'); c.width = i.width; c.height = i.height;
        const x = c.getContext('2d');
        x.drawImage(i, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height);
        if (!isMostlyWhiteEdges(d)) return resolve(dataUrl);
        cutoutWhiteBg(d);
        x.putImageData(d, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(dataUrl); }
    };
    i.onerror = () => resolve(dataUrl);
    i.src = dataUrl;
  });
}

// Map an extension Product onto the skill's normalized promo record. The product
// photo is inlined as a data: URI so the offscreen render needs no network.
async function productToRecord(p, { cutout = false } = {}) {
  const photo = await fetchImageData(p.imageUrl);
  let photoUrl = photo ? `data:${photo.mime};base64,${photo.base64}` : (p.imageUrl || '');
  if (cutout && photoUrl.startsWith('data:')) photoUrl = await cutoutPhotoDataUrl(photoUrl);
  const save = (p.priceNormal != null && p.priceSale != null && p.priceNormal > p.priceSale)
    ? p.priceNormal - p.priceSale : null;
  return {
    name: p.name || '',
    sku: p.code || '',
    photo: photoUrl,
    price_normal: p.priceNormal != null ? p.priceNormal : null,
    price_special: p.priceSale != null ? p.priceSale : null,
    save,
    pack_unit: (p._promo && p._promo.unit) || p.unitText || 'หน่วย',
    pack_text: p.note || '',
  };
}

// Render one promo card via the main-process Chromium template renderer.
// extra.bg (a data: URL) swaps Template B's built-in theme for an AI/uploaded background.
async function renderPromoCard(p, template, out, extra = {}) {
  const cutout = !!$('#cutout-auto')?.checked;
  const record = await productToRecord(p, { cutout });
  const opts = template === 'cny' ? { template: 'b', theme: 'cny' } : { template: 'a' };
  if (extra.bg) { opts.template = 'b'; delete opts.theme; opts.bg = extra.bg; }
  opts.size = $('#img-size')?.value || 'square';
  const card = el('div', 'banner-card');
  out.appendChild(card);
  let res;
  try { res = await window.cardRender(record, opts); }
  catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
  if (!res || !res.ok) {
    card.appendChild(empty('สร้างการ์ดไม่สำเร็จ' + (res && res.error ? `: ${res.error}` : '')));
    return;
  }
  const img = el('img'); img.src = res.dataUrl; card.appendChild(img);
  const foot = el('div', 'bc-foot');
  const dl = el('a'); dl.textContent = 'ดาวน์โหลด'; dl.download = `promo-${p.code}.png`; dl.href = res.dataUrl;
  foot.appendChild(dl);
  attachUpload(foot, () => res.dataUrl, p);
  card.appendChild(foot);
}

async function genAiImage() {
  const provider = $('#img-provider').value;
  const prompt = $('#img-prompt').value.trim();
  if (!prompt) return setStatus('#ai-image-status', 'ใส่คำอธิบายรูปก่อน', true);
  // bg mode = scene only, no product reference
  const ref = genMode === 'product' ? refImage : null;

  // Codex (free) — via the bridge /genimage (runs `codex exec`, no API key).
  if (provider === 'codex') {
    setStatus('#ai-image-status', ref ? 'กำลังให้ Codex สร้างรูปจากเรฟ… (ทดลอง)' : 'กำลังให้ Codex สร้างรูป… (อาจ 30–90 วินาที)');
    const req = buildCodexImageRequest($('#bridge-url').value.trim(), prompt, ref);
    const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (res.status === 0) return setStatus('#ai-image-status', `ต่อ bridge ไม่ได้ (${res.error || 'network'}) — รัน bridge แล้วยัง?`, true);
    let data;
    try { data = JSON.parse(res.text); }
    catch { return setStatus('#ai-image-status', `bridge ตอบ ${res.status} (ไม่ใช่ JSON)`, true); }
    if (!data.ok) return setStatus('#ai-image-status', 'Codex: ' + (data.error || `error ${res.status}`), true);
    showAiImage(`data:${data.mime || 'image/png'};base64,${data.base64}`);
    return setStatus('#ai-image-status', 'สร้างรูปเสร็จ (Codex ฟรี)');
  }

  // OpenAI / Gemini — needs an API key.
  const key = $('#img-key').value.trim();
  if (!key) return setStatus('#ai-image-status', 'ใส่ API key ก่อน', true);
  if (ref && provider === 'openai') {
    setStatus('#ai-image-status', 'หมายเหตุ: OpenAI ยังไม่รองรับเรฟในเวอร์ชันนี้ — จะสร้างจาก prompt อย่างเดียว');
  }
  setStatus('#ai-image-status', ref && provider === 'gemini' ? 'กำลังสร้างรูปจากเรฟ (Gemini)…' : 'กำลังสร้างรูป… (อาจใช้เวลาหน่อย)');
  let req;
  try {
    req = buildImageRequest(provider, key, prompt, {
      size: $('#img-ai-size').value,
      refImage: provider === 'gemini' ? ref : null,
    });
  }
  catch (e) { return setStatus('#ai-image-status', e.message, true); }
  const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) return setStatus('#ai-image-status', `เรียกไม่สำเร็จ (${res.status || 'network'}) ${apiErrorDetail(res)}`.trim(), true);
  let json;
  try { json = JSON.parse(res.text); }
  catch { return setStatus('#ai-image-status', 'ตอบกลับไม่ใช่ JSON', true); }
  let dataUrl;
  try { dataUrl = parseImageResponse(provider, json); }
  catch (e) { return setStatus('#ai-image-status', 'ผลลัพธ์: ' + e.message, true); }
  showAiImage(dataUrl);
  setStatus('#ai-image-status', 'สร้างรูปเสร็จ');
}

// Fetch a product image as { mime, base64 } (handles data: and http URLs).
async function fetchImageData(src) {
  if (!src) return null;
  if (src.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
    return m ? { mime: m[1], base64: m[2] } : null;
  }
  const res = await proxyFetch(src, { binary: true });
  if (!res.ok || !res.base64) return null;
  return { mime: res.contentType || 'image/jpeg', base64: res.base64 };
}

// Cut out the selected product (remove background) via Gemini image-to-image.
// Returns a clean product image you can drop onto a designed banner.
async function cutoutBackground() {
  const sel = selectedProducts();
  if (!sel.length) return setStatus('#ai-image-status', 'เลือกสินค้าก่อน แล้วกดลบพื้นหลัง', true);
  if ($('#img-provider').value !== 'gemini') {
    return setStatus('#ai-image-status', 'ลบพื้นหลังใช้ได้กับ Gemini — เลือกผู้ให้บริการเป็น Gemini + ใส่ key ก่อน', true);
  }
  const key = $('#img-key').value.trim();
  if (!key) return setStatus('#ai-image-status', 'ใส่ Gemini API key ก่อน', true);

  const p = sel[0];
  setStatus('#ai-image-status', 'กำลังดึงรูปสินค้า…');
  const ref = await fetchImageData(p.imageUrl);
  if (!ref) return setStatus('#ai-image-status', 'ดึงรูปสินค้าไม่สำเร็จ', true);

  const prompt =
    'Remove the background completely and isolate the product. ' +
    'Place the product centered on a clean, solid pure-white background. ' +
    'Keep the product\'s original colors, label, and details sharp. ' +
    'Do NOT add any text, watermark, shadow, or decoration.';
  setStatus('#ai-image-status', 'กำลังลบพื้นหลัง (Gemini)…');
  let req;
  try { req = buildImageRequest('gemini', key, prompt, { refImage: ref }); }
  catch (e) { return setStatus('#ai-image-status', e.message, true); }
  const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) return setStatus('#ai-image-status', `เรียกไม่สำเร็จ (${res.status || 'network'}) ${apiErrorDetail(res)}`.trim(), true);
  let json;
  try { json = JSON.parse(res.text); }
  catch { return setStatus('#ai-image-status', 'ตอบกลับไม่ใช่ JSON', true); }
  let dataUrl;
  try { dataUrl = parseImageResponse('gemini', json); }
  catch (e) { return setStatus('#ai-image-status', 'ผลลัพธ์: ' + e.message, true); }
  showAiImage(dataUrl);
  setStatus('#ai-image-status', 'ลบพื้นหลังเสร็จ — กด “ใส่ราคา/ข้อความโปร” เพื่อทำเป็นโฆษณาต่อได้');
}

function showAiImage(dataUrl) {
  const out = $('#ai-image-out');
  out.textContent = '';
  const card = el('div', 'banner-card');
  const img = el('img'); img.src = dataUrl;
  card.appendChild(img);
  const foot = el('div', 'bc-foot');
  const dl = el('a'); dl.textContent = 'ดาวน์โหลด'; dl.download = 'ai-image.png'; dl.href = dataUrl;
  foot.appendChild(dl);
  // The AI scene becomes Template B's Layer 0; the card renderer composites the
  // real product photo + crisp HTML prices/promo/footer on top.
  if (typeof window.cardRender === 'function') {
    const tb = el('button'); tb.textContent = '➕ ทำการ์ดโปรจากรูปนี้ (สินค้า + ราคา)';
    tb.addEventListener('click', () => aiBgToCards(dataUrl));
    foot.appendChild(tb);
  }
  attachUpload(foot, () => dataUrl, selectedProducts()[0]);
  card.appendChild(foot);
  out.appendChild(card);
}

// AI background → full Template B promo cards for every selected product:
// Layer 0 = the AI scene, Layer 1 = real product photo, Layer 2 = exact prices.
async function aiBgToCards(bgDataUrl) {
  const sel = selectedProducts();
  if (!sel.length) return setStatus('#ai-image-status', 'เลือกสินค้าก่อน — จะวางรูปสินค้า + ราคาลงบนพื้นหลังนี้', true);
  const out = $('#ai-image-out');
  let done = 0;
  setStatus('#ai-image-status', `กำลังทำการ์ดโปรจากพื้นหลัง AI… (${sel.length} สินค้า)`);
  for (const p of sel) {
    await renderPromoCard(p, 'cny', out, { bg: bgDataUrl });
    done++;
    setStatus('#ai-image-status', `การ์ดเสร็จ ${done}/${sel.length}`);
  }
  setStatus('#ai-image-status', `ทำการ์ดโปรเสร็จ ${done} ใบ — รูปสินค้า + ราคาคมชัดบนพื้นหลัง AI`);
}

// ---- canvas draw-plan renderer (executes compositor output) --------------
async function drawPlan(canvas, plan) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, plan.width, plan.height);
  for (const e of plan.elements) {
    if (e.type === 'rect') {
      ctx.fillStyle = e.fill || '#000';
      if (e.radius) { roundRect(ctx, e.x, e.y, e.w, e.h, e.radius); ctx.fill(); }
      else ctx.fillRect(e.x, e.y, e.w, e.h);
    } else if (e.type === 'image') {
      const img = await loadImg(e.src);
      if (img) drawImageFit(ctx, img, e);
    } else if (e.type === 'burst') {
      drawBurst(ctx, e);
    } else if (e.type === 'text') {
      drawText(ctx, e);
    }
  }
}

async function loadImg(src) {
  if (!src) return null;
  // Local upload (data: URL) — load straight into an Image, no proxy fetch.
  if (src.startsWith('data:')) {
    return await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = src;
    });
  }
  try {
    const res = await proxyFetch(src, { binary: true });
    if (!res.ok || !res.base64) return null;
    const dataUrl = `data:${res.contentType || 'image/jpeg'};base64,${res.base64}`;
    return await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = dataUrl;
    });
  } catch { return null; }
}

function drawImageFit(ctx, img, e) {
  const iw = img.width, ih = img.height;
  const s = e.fit === 'cover' ? Math.max(e.w / iw, e.h / ih) : Math.min(e.w / iw, e.h / ih);
  const w = iw * s, h = ih * s;
  const dx = e.x + (e.w - w) / 2, dy = e.y + (e.h - h) / 2;
  if (e.fit === 'cover') {
    ctx.save(); ctx.beginPath(); ctx.rect(e.x, e.y, e.w, e.h); ctx.clip();
    ctx.drawImage(img, dx, dy, w, h); ctx.restore();
  } else {
    ctx.drawImage(img, dx, dy, w, h);
  }
}

function drawText(ctx, e) {
  ctx.fillStyle = e.color || '#000';
  ctx.font = `${e.weight === 'bold' ? 'bold' : 'normal'} ${e.size}px "Sarabun","Segoe UI",sans-serif`;
  ctx.textAlign = e.align || 'left';
  ctx.textBaseline = e.align === 'center' ? 'middle' : 'top';
  const lines = e.maxWidth ? wrapText(ctx, e.text, e.maxWidth) : [String(e.text)];
  let y = e.y;
  for (const line of lines) {
    ctx.fillText(line, e.x, y);
    if (e.strike) {
      const w = ctx.measureText(line).width;
      const sx = e.align === 'center' ? e.x - w / 2 : e.align === 'right' ? e.x - w : e.x;
      const sy = e.align === 'center' ? y : y + e.size / 2;
      ctx.strokeStyle = e.color || '#000';
      ctx.lineWidth = Math.max(2, e.size / 16);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + w, sy); ctx.stroke();
    }
    y += e.size * 1.25;
  }
}

// Char-based wrap (Thai has no spaces).
function wrapText(ctx, text, maxWidth) {
  const out = [];
  let cur = '';
  for (const ch of String(text)) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) { out.push(cur); cur = ch; }
    else cur = test;
  }
  if (cur) out.push(cur);
  return out.length ? out : [String(text)];
}

// Starburst seal — a spiky circle (alternating outer/inner radius points).
function drawBurst(ctx, e) {
  const pts = e.points || 12;
  ctx.fillStyle = e.fill || '#000';
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? e.rOuter : e.rInner;
    const a = (Math.PI / pts) * i - Math.PI / 2;
    const x = e.cx + r * Math.cos(a);
    const y = e.cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- content tab ---------------------------------------------------------
function bindContentTab() {
  $('#gen-content').addEventListener('click', genContent);
}

async function genContent() {
  const sel = selectedProducts();
  if (!sel.length) return setStatus('#content-status', 'เลือกสินค้าก่อน', true);
  const types = [];
  if ($('#ct-alt').checked) types.push('altText');
  if ($('#ct-closing').checked) types.push('closingText');
  if ($('#ct-caption').checked) types.push('caption');
  if ($('#ct-headline').checked) types.push('headline');
  if (!types.length) return setStatus('#content-status', 'เลือกอย่างน้อย 1 ประเภท', true);

  const opts = { types, tone: $('#ct-tone').value, audience: $('#ct-audience').value, length: $('#ct-length').value };
  const prompt = buildContentPrompt(sel, opts);
  setStatus('#content-status', 'กำลังให้ crm-marketer เขียนคอนเทนต์…');
  let text;
  try { text = await runViaBackend(prompt); }
  catch (e) { return setStatus('#content-status', e.message, true); }
  let c;
  try { c = parseContentResponse(text); }
  catch (e) { return setStatus('#content-status', 'แปลผลไม่สำเร็จ: ' + e.message, true); }
  renderContent(c);
  setStatus('#content-status', 'เสร็จ');
}

function renderContent(c) {
  const out = $('#content-out');
  out.textContent = '';
  const blocks = [];
  if (c.altText) blocks.push(['altText', c.altText, true]);
  if (c.closingText) blocks.push(['ข้อความปิดการขาย', c.closingText, false]);
  (c.captions || []).forEach((cap, i) => { if (cap) blocks.push([`แคปชัน ${i + 1}`, cap, false]); });
  if (c.headline) blocks.push(['พาดหัว', c.headline, false]);
  if (!blocks.length) { out.appendChild(empty('ไม่มีผลลัพธ์')); return; }

  for (const [label, txt, isAlt] of blocks) {
    const b = el('div', 'content-block');
    const lab = el('div', 'cb-label'); lab.textContent = label;
    const t = el('div', 'cb-text'); t.textContent = txt;
    const act = el('div', 'cb-actions');
    const copy = el('button'); copy.textContent = 'คัดลอก';
    copy.addEventListener('click', () => navigator.clipboard.writeText(txt).then(() => {
      copy.textContent = 'คัดลอกแล้ว'; setTimeout(() => { copy.textContent = 'คัดลอก'; }, 1200);
    }).catch(() => {}));
    act.appendChild(copy);
    if (isAlt) {
      const use = el('button'); use.textContent = 'ใช้เป็น altText';
      use.addEventListener('click', () => { $('#alt-text').value = txt; if (!aiOverride) rebuild(); use.textContent = 'ใส่แล้ว'; });
      act.appendChild(use);
    }
    b.append(lab, t, act);
    out.appendChild(b);
  }
}

function appendChat(who, text) {
  const log = $('#chat-log');
  const m = el('div', `chat-msg ${who}`);
  m.textContent = text;
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
}

// ---- status + storage + proxy --------------------------------------------
function loadStatus(text, isError) { setStatus('#load-status', text, isError); }
function exportStatus(text, isError) { setStatus('#export-status', text, isError); }
function chatStatus(text, isError) { setStatus('#chat-status', text, isError); }
function setStatus(sel, text, isError) {
  const node = $(sel);
  node.textContent = text;
  node.className = 'status ' + (isError ? 'error' : 'ok');
}

function save(obj) { try { chrome.storage?.local?.set(obj); } catch { /* ignore */ } }

async function restore() {
  try {
    const s = await chrome.storage.local.get(['sheetUrl', 'sheetName', 'jsonUrl', 'anthropicKey', 'cachedProducts', 'aiBackend', 'bridgeUrl', 'imgProvider', 'imgKey', 'hostProvider', 'imgbbKey', 'cldCloud', 'cldPreset', 'promoLogo', 'promoContact', 'promoShipfree', 'promoToken', 'customPresets']);
    if (Array.isArray(s.customPresets)) {
      customPresets = s.customPresets;
      renderCustomPresets(); refreshPresetSelects();
    }
    if (s.sheetUrl) $('#sheet-url').value = s.sheetUrl;
    if (s.sheetName) $('#sheet-name').value = s.sheetName;
    if (s.jsonUrl) $('#json-url').value = s.jsonUrl;
    if (s.anthropicKey) $('#api-key').value = s.anthropicKey;
    if (s.bridgeUrl) $('#bridge-url').value = s.bridgeUrl;
    if (s.aiBackend) $('#ai-backend').value = s.aiBackend;
    if (s.imgProvider) $('#img-provider').value = s.imgProvider;
    if (s.imgKey) $('#img-key').value = s.imgKey;
    if (s.hostProvider) $('#host-provider').value = s.hostProvider;
    if (s.imgbbKey) $('#imgbb-key').value = s.imgbbKey;
    if (s.cldCloud) $('#cld-cloud').value = s.cldCloud;
    if (s.cldPreset) $('#cld-preset').value = s.cldPreset;
    if (s.promoLogo) promoLogo = s.promoLogo;
    if (s.promoContact) $('#promo-contact').value = s.promoContact;
    if (s.promoShipfree === false) $('#promo-shipfree').checked = false;
    if (s.promoToken) {
      $('#promo-token').value = s.promoToken;
      const d = $('#promo-token').closest('details');
      if (d) d.open = true; // surface the saved full-set token on launch
    }
    applyBackendUi();
    applyImgProviderUi();
    applyHostProviderUi();

    const c = s.cachedProducts;
    if (c && Array.isArray(c.products) && c.products.length) {
      products = c.products;
      presetByCode.clear();
      selectedCodes.clear();
      for (const p of products) presetByCode.set(p.code, p.promoType);
      renderList();
      loadStatus(`จาก cache: ${products.length} รายการ · ${c.label || ''} · ล่าสุด ${new Date(c.fetchedAt).toLocaleString()} — กดปุ่มโหลดเพื่อรีเฟรช`);
    }
  } catch { /* storage unavailable */ }
}

// GET by default; pass { method, headers, body } for POST (AI call).
// Pull the human-readable error message out of a failed API response
// (OpenAI/Gemini both put it under error.message in the JSON body).
function apiErrorDetail(res) {
  if (res.error) return res.error;
  try {
    const j = JSON.parse(res.text);
    const e = j && j.error;
    if (e) return (typeof e === 'string' ? e : e.message || e.status || '');
  } catch { /* not JSON — fall through */ }
  return (res.text || '').slice(0, 200);
}

function proxyFetch(url, opts = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'fetch', url, method: opts.method, headers: opts.headers, body: opts.body, binary: opts.binary },
        (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, status: 0, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { ok: false, status: 0, error: 'ไม่มีการตอบกลับจาก service worker' });
          }
        },
      );
    } catch (e) {
      resolve({ ok: false, status: 0, error: String(e?.message || e) });
    }
  });
}
