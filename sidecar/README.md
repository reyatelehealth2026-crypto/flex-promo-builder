# Prom9 Sidecar (Phase 4)

Python FastAPI local sidecar — แทนที่ `bridge/server.cjs` ตัวเดิม (Node) และรวมงาน AI/creative
จาก `lib/` มาไว้ฝั่ง Python:

- **AI content** — port ของ `lib/ai.js` (crm-marketer persona, edit/advise prompts, Anthropic API + `claude -p` CLI)
- **Image generation** — port ของ `lib/imagegen.js` (OpenAI `gpt-image-1`, Gemini image) + `codex exec` แบบฟรีตามเดิม
- **Background cutout** — port ของ `lib/cutout.js` (flood-fill พื้นขาว, feather edge)
- **Prompt kit** — port ของ `lib/promptkit.js` + REST endpoints ให้ UI ใช้
- **Multi-size export** — รูปเดียว → 1080×1080 / 1080×1350 / 1080×1920 / 1040×1040 ใน batch เดียว (Pillow, cover-crop centered)
- **ตัวตรวจคำเสี่ยงสุขภาพ** — rule-based ตามแนวกฎโฆษณา อย. (ไทย + อังกฤษ) แก้ rule ได้ที่ `app/data/health_claim_rules.json`

## Run

```bash
cd sidecar
uv venv .venv && uv pip install --python .venv/bin/python -e ".[dev]"
# หรือ: pip3 install fastapi "uvicorn[standard]" pillow httpx pytest

.venv/bin/uvicorn app.main:app --port 8765        # หรือ: .venv/bin/python -m app.main
```

Default bind = `127.0.0.1:8765` — **port และ env vars เดิมของ bridge/server.cjs**:

| Env var | Default | ความหมาย |
|---|---|---|
| `FLEX_BRIDGE_PORT` | `8765` | port |
| `FLEX_BRIDGE_HOST` | `127.0.0.1` | ตั้ง `0.0.0.0` เพื่อเปิดให้ LAN (ระวัง: ใครในเครือข่ายสั่ง claude/codex เครื่องนี้ได้) |
| `ANTHROPIC_API_KEY` | — | สำหรับ backend `api` ของ `/ai/*` (ไม่ตั้งก็ใช้ backend `cli` ผ่าน `claude -p` login เดิมได้) |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | — | สำหรับ `/images/generate` (หรือส่ง `apiKey` มาใน request) |

ไม่มี secret ฝังในโค้ด — key มาจาก env หรือ request เท่านั้น.

Interactive docs: `http://127.0.0.1:8765/docs`

## Tests

```bash
cd sidecar && .venv/bin/python -m pytest
```

External API / CLI ถูก mock ทั้งหมดในเทสต์; Pillow endpoints รันจริง.

## Endpoints

### Compatible กับ bridge/server.cjs เดิม (drop-in)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/ping` | → `{ok, service:"flex-bridge"}` |
| POST | `/run` | `{prompt}` → `{ok, text}` — รัน `claude -p` (prompt logic อยู่ฝั่ง caller ตามเดิม) |
| POST | `/edit` | `{flex, instruction}` → `{ok, text}` — prompt เดียวกับ bridge เดิมเป๊ะ |
| POST | `/genimage` | `{prompt, refBase64?}` → `{ok, base64, mime}` — `codex exec` (ฟรี, ใช้ login เดิม) |

Error shape เดิม: HTTP 500 + `{ok:false, error:"..."}` (รวมข้อความไทยเดิม เช่น `ต้องมี prompt`).

### AI (lib/ai.js port)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/ai/edit` | `{flex, instruction, mode?: 'apply'\|'advise', backend?: 'cli'\|'api', apiKey?}` → apply: `{ok, flex}` · advise: `{ok, advice:[..], flex\|null}` |
| POST | `/ai/generate` | `{prompt, maxTokens?, backend?, apiKey?}` → `{ok, text}` |

backend `cli` (default) = `claude -p` ไม่ต้องมี key; backend `api` = Anthropic Messages API
(`claude-opus-4-8`, `output_config.effort: low`; รองรับทั้ง API key `sk-ant-api...` → `x-api-key`
และ OAuth token `sk-ant-oat...` → `Authorization: Bearer` + oauth beta header — ตรรกะเดียวกับ `lib/ai.js`).

### Images

| Method | Path | Body → Response |
|---|---|---|
| POST | `/images/generate` | `{provider:'openai'\|'gemini', prompt, size?, refImage?:{mime?,base64}, apiKey?}` → `{ok, dataUrl, mime, base64}` |
| POST | `/images/cutout` | `{base64, threshold?:236, feather?:2, auto?:false}` → `{ok, base64, mime, applied}` — ตัดพื้นขาวด้วย flood-fill จากขอบ; `auto` = ตัดเฉพาะรูปขอบขาว |
| POST | `/images/export` | `{base64, sizes?:[[w,h],...], format?:'png'\|'jpeg'\|'webp', quality?:90}` → `{ok, images:[{width,height,mime,base64},...]}` — default sizes 1080², 1080×1350, 1080×1920, 1040² |

### Prompt kit

| Method | Path | Response |
|---|---|---|
| GET | `/promptkit/kits` | `{ok, kit:{purpose,style,theme,elements,mood}, safetyTail}` |
| GET | `/promptkit/kits/{category}` | `{ok, category, entries}` |
| GET | `/promptkit/defaults?mode=product\|bg` | `{ok, selection}` |
| POST | `/promptkit/compose` | `{mode, purposeId?, styleId?, themeId?, elementIds?, moodId?, productName?, extra?}` → `{ok, prompt}` |

ทุก prompt ปิดท้ายด้วย no-text safety tail เสมอ (ห้าม AI วาดตัวหนังสือ/ตัวเลขไทย).
Kit data แก้ได้ที่ `app/data/promptkit.json`.

### Health-claim risk checker (อย.)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/risk/check` | `{text, langs?:['th','en']}` → `{ok, risk_level:'none'\|'low'\|'medium'\|'high', counts, findings:[{rule_id, category, severity, term, match, start, end, message, suggestion}]}` |
| GET | `/risk/rules` | `{ok, rules:[...]}` — rule list ทั้งหมด |

ครอบคลุม: อ้างรักษา/หายขาด, ป้องกัน/ต้านโรค, อ้างผลต่อเบาหวาน-ความดัน-ไขมัน-ตับ-ไต,
ลดน้ำหนัก + การันตีตัวเลข, การันตีผล/เห็นผลใน N วัน, คำต้องห้ามตามกฎหมายยา
(ดีที่สุด เด็ดขาด ศักดิ์สิทธิ์ มหัศจรรย์ วิเศษ หายห่วง), อ้าง อย./FDA รับรอง,
ปลอดภัย 100%/ไม่มีผลข้างเคียง, สมรรถภาพทางเพศ, ดีท็อกซ์, ความงามเกินจริง,
และ pattern อังกฤษ (cures, treats, FDA approved, guaranteed results, miracle, no side effects, ...).
แต่ละ finding มีตำแหน่งตัวอักษร (`start`/`end`) + ข้อความทางเลือกที่ปลอดภัยกว่า (`suggestion`).

แก้/เพิ่มคำได้ที่ `app/data/health_claim_rules.json` (รีสตาร์ตเซิร์ฟเวอร์เพื่อโหลดใหม่).

## ต่างจาก bridge/server.cjs ตรงไหน

- `/ping` เพิ่ม field `implementation:"prom9-sidecar"` (field `ok`/`service` เดิมคงไว้)
- เพิ่ม timeout ให้ subprocess (`claude`/`codex` 10 นาที) — bridge เดิมรอไม่จำกัด
- มี OpenAPI docs ที่ `/docs`
- endpoints ใหม่ทั้งหมด (`/ai/*`, `/images/*`, `/promptkit/*`, `/risk/*`) เป็นส่วนเพิ่ม ไม่กระทบ client เดิม

## Layout

```
sidecar/
  app/
    main.py            # app factory + uvicorn entrypoint
    routers/           # bridge (compat), ai, images, promptkit, risk
    services/          # ai, imagegen, cutout, promptkit, export, risk, cli_runner
    data/              # promptkit.json, health_claim_rules.json (แก้ได้)
  tests/               # pytest (120 tests)
```
