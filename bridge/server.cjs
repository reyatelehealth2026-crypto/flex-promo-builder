#!/usr/bin/env node
// Local bridge: lets the flex-promo-builder extension edit Flex JSON through
// your existing Claude Code login (no API key) by shelling out to `claude -p`.
//
// Run:  node bridge/server.cjs    (keep it open while using the extension)
// The extension's AI chat (backend = "Claude Code") calls POST /edit here.
// Binds to 127.0.0.1 only — not reachable from the network.

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.FLEX_BRIDGE_PORT) || 8765;
// Default 127.0.0.1 (local only). Set FLEX_BRIDGE_HOST=0.0.0.0 to expose it on
// the LAN so another machine's Studio app can reach this machine's claude/codex.
const HOST = process.env.FLEX_BRIDGE_HOST || '127.0.0.1';
const CODEX_IMAGES_DIR = path.join(os.homedir(), '.codex', 'generated_images');

// Find the newest .png anywhere under a directory tree.
function newestPng(dir) {
  let best = null;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d); } catch { return; }
    for (const name of entries) {
      const p = path.join(d, name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.png$/i.test(name) && (!best || st.mtimeMs > best.mtime)) best = { path: p, mtime: st.mtimeMs };
    }
  };
  walk(dir);
  return best;
}

// Generate an image FOR FREE via `codex exec` (uses the user's Codex/ChatGPT
// login — no API key). codex saves to ~/.codex/generated_images/<id>/ig_*.png;
// we return the newest png produced by this run.
function runCodexImage(prompt, refPath = null) {
  return new Promise((resolve, reject) => {
    const before = newestPng(CODEX_IMAGES_DIR);
    const beforeMtime = before ? before.mtime : 0;
    const child = spawn('codex', ['exec', '--skip-git-repo-check'], { shell: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`spawn codex failed: ${e.message} (codex อยู่ใน PATH ไหม?)`)));
    child.on('close', () => {
      const after = newestPng(CODEX_IMAGES_DIR);
      if (after && after.mtime > beforeMtime) {
        try { resolve({ base64: fs.readFileSync(after.path).toString('base64'), mime: 'image/png' }); }
        catch (e) { reject(e); }
      } else {
        const lastErr = err.trim().split('\n').slice(-1)[0] || '';
        const authish = /401|unauthor|logged in|missing bearer|login/i.test(err);
        reject(new Error(authish
          ? 'codex ยังไม่ได้ login (CLI) — รัน "codex login" ในเทอร์มินอลแล้วเช็ค "codex login status" ให้ขึ้น logged in ก่อน'
          : (lastErr || 'codex ไม่ได้สร้างรูป (เช็ค codex login / โควต้า)')));
      }
    });
    const refLine = refPath
      ? `Use the image at "${refPath}" as a visual reference for composition, subject, and colors. `
      : '';
    child.stdin.write(
      `Use your built-in image generation tool to create this image (do NOT write code to draw it): ${prompt}\n` +
      refLine +
      `Generate one PNG image. After generating, reply with just the file path.`,
    );
    child.stdin.end();
  });
}

// Persist a base64 reference image to a temp PNG; returns the path (or null).
function writeRefImage(refBase64) {
  if (!refBase64) return null;
  try {
    const p = path.join(os.tmpdir(), `flexref-${Date.now()}.png`);
    fs.writeFileSync(p, Buffer.from(refBase64, 'base64'));
    return p;
  } catch { return null; }
}

// Run `claude -p`, feeding the prompt via stdin (avoids the ~8KB Windows
// command-line limit — flex carousels are large).
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p'], { shell: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`spawn claude failed: ${e.message} (claude อยู่ใน PATH ไหม?)`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `claude exited ${code}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'flex-bridge' }));
    return;
  }

  // Generic runner: { prompt } -> { ok, text }. All prompt logic lives in the app (lib/*).
  if (req.method === 'POST' && req.url === '/run') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { prompt } = JSON.parse(body);
        if (!prompt) throw new Error('ต้องมี prompt');
        const text = await runClaude(prompt);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, text }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  // Free image generation via codex (no API key). { prompt } -> { ok, base64, mime }
  if (req.method === 'POST' && req.url === '/genimage') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let refPath = null;
      try {
        const { prompt, refBase64 } = JSON.parse(body);
        if (!prompt) throw new Error('ต้องมี prompt');
        refPath = writeRefImage(refBase64);
        const img = await runCodexImage(prompt, refPath);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, base64: img.base64, mime: img.mime }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      } finally {
        if (refPath) { try { fs.unlinkSync(refPath); } catch { /* ignore */ } }
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/edit') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { flex, instruction } = JSON.parse(body);
        if (!flex || !instruction) throw new Error('ต้องมี flex + instruction');
        const prompt =
          `You are a LINE Flex Message design editor.\n` +
          `Here is a LINE Flex Message JSON:\n\n${flex}\n\n` +
          `Apply this instruction (Thai or English): ${instruction}\n\n` +
          `Return ONLY the complete updated JSON — no prose, no markdown fences. ` +
          `Keep it valid per LINE Flex spec and preserve every field you are not changing, ` +
          `especially hero image URLs and the footer button "action".`;
        const text = await runClaude(prompt);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, text }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.on('error', (e) => {
  // EADDRINUSE etc. — don't crash the host (e.g. when embedded in the desktop app)
  process.stderr.write(`bridge listen error: ${e.message}\n`);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Flex bridge → http://${HOST}:${PORT}  (POST /run · /edit · /genimage · GET /ping)\n`);
  process.stdout.write(`ใช้ claude -p / codex ของเครื่องนี้ (login เดิม ไม่ต้องมี API key) · เปิดค้างไว้\n`);
  if (HOST === '0.0.0.0') {
    process.stdout.write(`⚠️  เปิดให้ทั้ง LAN เข้าถึง — ใครในเครือข่ายก็สั่ง claude/codex ผ่านเครื่องนี้ได้ ใช้เฉพาะเน็ตที่ไว้ใจ\n`);
  }
});

module.exports = server;
