// MV3 service worker:
//  1. open the side panel when the toolbar icon is clicked
//  2. proxy cross-domain fetches (Sheet CSV / JSON URL) so the panel sidesteps CORS

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('setPanelBehavior failed', err));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'fetch') return false;

  fetch(msg.url, {
    method: msg.method || 'GET',
    redirect: 'follow',
    credentials: 'omit',
    headers: msg.headers || {},
    body: msg.body,
  })
    .then(async (res) => {
      if (msg.binary) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        sendResponse({ ok: res.ok, status: res.status, base64: btoa(bin), contentType: res.headers.get('content-type') || '' });
      } else {
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, text });
      }
    })
    .catch((err) => {
      sendResponse({ ok: false, status: 0, error: String(err?.message || err) });
    });

  return true; // keep the message channel open for the async response
});
