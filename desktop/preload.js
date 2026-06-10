// Minimal chrome.* shim so the existing extension panel.js runs unchanged in Electron.
// Maps the three chrome APIs panel.js uses onto IPC handlers in main.js.
// (contextIsolation:false → this `window.chrome` is visible to panel.js.)

const { ipcRenderer } = require('electron');

window.chrome = {
  runtime: {
    lastError: null,
    // panel.js: proxyFetch -> sendMessage({type:'fetch', url, method, headers, body}, cb)
    sendMessage(msg, cb) {
      if (msg && msg.type === 'fetch') {
        ipcRenderer
          .invoke('fetch', { url: msg.url, method: msg.method, headers: msg.headers, body: msg.body, binary: msg.binary })
          .then((r) => cb && cb(r))
          .catch((e) => cb && cb({ ok: false, status: 0, error: String(e?.message || e) }));
      } else if (cb) {
        cb({ ok: false, status: 0, error: 'unknown message' });
      }
    },
  },
  storage: {
    local: {
      get: (keys) => ipcRenderer.invoke('store-get', keys),       // returns a Promise (panel.js awaits it)
      set: (obj) => ipcRenderer.invoke('store-set', obj),
    },
  },
  tabs: {
    create: ({ url }) => ipcRenderer.invoke('open-external', url), // "เปิดใน LINE Simulator"
  },
};
