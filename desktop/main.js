// Electron main process for Flex Promo Builder desktop.
// Reuses the side-panel UI (../sidepanel/panel.html) and lib/* unchanged.
// - 'fetch' IPC does network calls in the main process → no CORS (CNY / Anthropic / bridge).
// - The Claude Code bridge (claude -p) is embedded, so there's no separate server to run.
// - 'store-*' IPC persists settings/cache to a JSON file (replaces chrome.storage.local).

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Embed the bridge (binds 127.0.0.1:8765; its own error handler prevents crashes).
try { require('../bridge/server.cjs'); } catch (e) { console.error('bridge not started:', e.message); }

const STORE_PATH = path.join(app.getPath('userData'), 'store.json');
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch { return {}; } };
const writeStore = (o) => { try { fs.writeFileSync(STORE_PATH, JSON.stringify(o)); } catch (e) { console.error('store write', e.message); } };

ipcMain.handle('fetch', async (_e, { url, method, headers, body, binary }) => {
  try {
    const res = await fetch(url, { method: method || 'GET', headers: headers || {}, body, redirect: 'follow' });
    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, base64: buf.toString('base64'), contentType: res.headers.get('content-type') || '' };
    }
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) };
  }
});

ipcMain.handle('store-get', (_e, keys) => {
  const all = readStore();
  if (!keys) return all;
  const arr = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const k of arr) if (k in all) out[k] = all[k];
  return out;
});

ipcMain.handle('store-set', (_e, obj) => {
  const all = readStore();
  Object.assign(all, obj);
  writeStore(all);
  return true;
});

ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));

// Render a promo card (skill template A/B) to PNG with the bundled Chromium.
const { renderCard } = require('./card-renderer.cjs');
ipcMain.handle('render-card', async (_e, { record, opts }) => {
  try {
    return { ok: true, dataUrl: await renderCard(record || {}, opts || {}) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// Window refs for the chat relay (offscreen capture windows from
// card-renderer.cjs also live in getAllWindows(), so keep explicit refs).
let mainWin = null;
let chatWin = null;

// AI design chat in its OWN window so the main window never lags.
function createChatWindow() {
  if (chatWin && !chatWin.isDestroyed()) { chatWin.focus(); return; }
  chatWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: 'แชทกับ AI — แก้ดีไซน์',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,  // same shim as the main window
      nodeIntegration: false,
      webSecurity: false,       // chat.js imports ../lib/ai.js over file://
    },
  });
  chatWin.removeMenu();
  chatWin.loadFile(path.join(__dirname, '..', 'sidepanel', 'chat.html'));
  chatWin.on('closed', () => { chatWin = null; });
}

ipcMain.handle('open-chat-window', () => { createChatWindow(); return { ok: true }; });

// Relay between main panel and chat window: {to:'main'|'chat', type, data}
// → other window receives webContents.send('chat-msg', {type, data}).
ipcMain.handle('chat-relay', (_e, { to, type, data }) => {
  const target = to === 'chat' ? chatWin : mainWin;
  if (target && !target.isDestroyed()) {
    target.webContents.send('chat-msg', { type, data });
    return { ok: true, delivered: true };
  }
  return { ok: true, delivered: false };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    title: 'Flex Promo Builder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,  // so the chrome.* shim in preload is visible to panel.js
      nodeIntegration: false,
      webSecurity: false,       // allow ES-module imports (panel.js → ../lib/*) over file://
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'sidepanel', 'panel.html'));
  mainWin = win;
  win.on('closed', () => { mainWin = null; });
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => app.quit());
