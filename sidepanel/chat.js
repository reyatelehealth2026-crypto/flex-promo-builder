// Standalone AI design chat — runs in its OWN BrowserWindow so the main
// window never lags. Talks to panel.js only via window.chatBus (IPC relay):
//   chat → main : 'chat-ready' {}            ขอ context จากหน้าหลัก
//   main → chat : 'context'    {flexJson, productsSummary, backend:{kind,bridgeUrl,apiKey?}}
//   chat → main : 'apply-flex' {flex, altText?}
//   main → chat : 'applied'    {ok}
// Builds the AI request itself (lib/ai.js) — never imports panel.js.

import { buildEditPrompt, buildAiRequest, buildBridgeRunRequest, textFromResponse, parseEditResponse } from '../lib/ai.js';

const $ = (sel) => document.querySelector(sel);

let ctx = null;          // last 'context' from the main window
let chatMode = 'advise'; // 'advise' (แนะนำก่อน) | 'apply' (แก้เลย)

// ---- chat-bus wiring ------------------------------------------------------
window.chatBus.on(({ type, data }) => {
  if (type === 'context') {
    ctx = data || {};
    if (ctx.productsSummary) status(`พร้อมแก้: ${ctx.productsSummary}`);
    else status('ได้รับดีไซน์จากหน้าหลักแล้ว');
  } else if (type === 'applied') {
    if (data && data.ok) bubble('sys', '✅ หน้าหลักใช้ดีไซน์นี้แล้ว — ดูพรีวิวที่หน้าหลัก');
    else bubble('sys', '⚠️ หน้าหลักใช้ดีไซน์ไม่สำเร็จ');
  }
});

// Ask the main window for the current flex + backend settings.
window.chatBus.send('main', 'chat-ready', {}).then((r) => {
  if (!r || !r.delivered) status('ยังไม่เชื่อมกับหน้าหลัก — เปิดหน้าหลักไว้ด้วย', true);
});

// ---- UI -------------------------------------------------------------------
function setChatMode(m) {
  chatMode = m;
  $('#mode-advise').classList.toggle('active', m === 'advise');
  $('#mode-apply').classList.toggle('active', m === 'apply');
}
$('#mode-advise').addEventListener('click', () => setChatMode('advise'));
$('#mode-apply').addEventListener('click', () => setChatMode('apply'));

$('#send').addEventListener('click', sendChat);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

function status(msg, isErr = false) {
  const s = $('#status');
  s.textContent = msg || '';
  s.classList.toggle('err', !!isErr);
}

function bubble(kind, text) {
  const log = $('#log');
  const b = document.createElement('div');
  b.className = `bubble ${kind}`;
  b.textContent = text;
  log.appendChild(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

// AI bubble with optional advice list + "ใช้ดีไซน์นี้" button.
function aiBubble(text, advice, flex) {
  const b = bubble('ai', text || '');
  if (advice && advice.length) {
    const ul = document.createElement('ul');
    advice.forEach((a) => { const li = document.createElement('li'); li.textContent = a; ul.appendChild(li); });
    b.appendChild(ul);
  }
  if (flex) {
    const btn = document.createElement('button');
    btn.className = 'apply-btn';
    btn.textContent = '✅ ใช้ดีไซน์นี้';
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'ส่งให้หน้าหลักแล้ว…';
      const r = await window.chatBus.send('main', 'apply-flex', { flex });
      if (!r || !r.delivered) { btn.disabled = false; btn.textContent = '✅ ใช้ดีไซน์นี้'; status('ส่งไม่ถึงหน้าหลัก — เปิดหน้าหลักไว้ด้วย', true); }
    });
    b.appendChild(btn);
  }
  $('#log').scrollTop = $('#log').scrollHeight;
}

// ---- send -----------------------------------------------------------------
async function sendChat() {
  const text = $('#input').value.trim();
  if (!text) return;
  if (!ctx || !ctx.flexJson) {
    status('ยังไม่มีดีไซน์จากหน้าหลัก — เลือกสินค้าที่หน้าหลักก่อน', true);
    await window.chatBus.send('main', 'chat-ready', {});
    return;
  }

  bubble('user', text);
  $('#input').value = '';
  $('#send').disabled = true;

  try {
    const result = await runEdit(ctx, text, chatMode);
    if (result) {
      if (chatMode === 'advise') {
        aiBubble('คำแนะนำจาก crm-marketer', result.advice || [], result.flex || null);
      } else {
        aiBubble('แก้ดีไซน์ให้แล้ว — กดปุ่มด้านล่างเพื่อใช้กับหน้าหลัก', [], result);
      }
      status('');
    }
  } catch (e) {
    bubble('ai', '(แปลผลไม่สำเร็จ)');
    status('AI: ' + (e && e.message ? e.message : String(e)), true);
  } finally {
    $('#send').disabled = false;
  }
}

// Run the edit via the backend from context ('bridge' or API key) -> parsed result.
async function runEdit(c, instruction, mode) {
  const flexJson = typeof c.flexJson === 'string' ? c.flexJson : JSON.stringify(c.flexJson);
  const backend = c.backend || {};

  if (backend.kind === 'bridge') {
    status('กำลังให้ Claude Code (crm-marketer) แก้ดีไซน์… (อาจช้าหน่อย)');
    const prompt = buildEditPrompt(flexJson, instruction, mode);
    const req = buildBridgeRunRequest(backend.bridgeUrl, prompt);
    const res = await proxyFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!res.ok) {
      status(`เรียก bridge ไม่สำเร็จ (${res.status || 'network'}) ${res.error || ''}`.trim(), true);
      return null;
    }
    const data = JSON.parse(res.text);
    if (!data.ok) { status('Claude Code error: ' + (data.error || ''), true); return null; }
    return parseEditResponse(data.text, mode);
  }

  const key = (backend.apiKey || '').trim();
  if (!key) { status('ยังไม่มี Anthropic API key — ตั้งค่าที่หน้าหลักก่อน', true); return null; }
  status('กำลังให้ crm-marketer แก้ดีไซน์…');
  const req = buildAiRequest(key, flexJson, instruction, mode);
  const res = await proxyFetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  if (!res.ok) {
    const hint = res.status === 401 ? ' — key ผิด หรือเป็น OAuth token (ต้อง sk-ant-api03)' : '';
    status(`เรียก AI ไม่สำเร็จ (${res.status || 'network'}) ${res.error || ''}${hint}`.trim(), true);
    return null;
  }
  return parseEditResponse(textFromResponse(JSON.parse(res.text)), mode);
}

// GET by default; pass { method, headers, body } for POST (same shim as panel.js).
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
