# TODO — Prom9 Migration

## Phase 1 — Stabilize Electron (~1 สัปดาห์)

- [x] สร้าง golden fixtures จาก flex-builder.js จริง
- [x] เก็บ gen-fixtures.mjs + fixtures.json เข้า repo ที่ test/golden/
- [x] เพิ่ม `"type": "module"` ใน package.json (ลด warning + overhead ตอน parse)
- [x] Debounce search ที่ panel.js:254 (~150ms)
- [x] แยก state + pure functions ออกจาก panel.js เป็น sidepanel/state.js (ไม่แตะ DOM code)
- [ ] เปลี่ยน store-set เป็น debounced write (ไม่เขียนไฟล์ทุก keystroke)

## Phase 2 — Rust Core (3–4 สัปดาห์)

- [ ] สร้าง crate prom9_core (workspace layout: flex/, ingest/, creative/)
- [ ] Port flex-builder.js → flex/builder.rs (5 templates: classic, promo, bigprice, minimal, urgent)
- [ ] Replicate money() float-taming ให้เป๊ะ (test case float-edge ใน fixtures)
- [ ] Port validate.js → flex/validate.rs (12 bubbles, 50KB, https check, label ≤20)
- [ ] Golden test: อ่าน fixtures.json → canonical JSON → assert match ทุก case
- [ ] Port adapters.js + cny.js + promo.js → ingest/
- [ ] Port compositor.js → creative/ (draw-plan struct)

## Phase 3 — Flutter Prototype (4 สัปดาห์)

- [ ] Scaffold project ตามโครง features/ + ติดตั้ง flutter_rust_bridge v2
- [ ] เชื่อม prom9_core ผ่าน FFI + generate Dart models
- [ ] Product Hub: list (ListView.builder) + search + filter + multi-select
- [ ] SQLite + FTS5 สำหรับ search 10k SKU
- [ ] Flex preview widget (render bubble JSON เป็น Flutter widget)
- [ ] Export Flex JSON + validation UI
- [ ] Card renderer ด้วย CustomPainter จาก compositor draw-plan (แทน offscreen Chromium → batch ขนานได้)

## Phase 4 — AI + Creative (4–6 สัปดาห์)

- [ ] Python sidecar (FastAPI local) แทน bridge/server.cjs
- [ ] ย้าย AI content / imagegen / cutout ไป sidecar
- [ ] Prompt kit UI (port promptkit.js)
- [ ] Export ภาพหลายขนาด (1080², 1080×1350, 1080×1920, 1040²) แบบ batch
- [ ] ระบบตรวจคำเสี่ยงด้านสุขภาพ (rule-based ก่อน)

---

หมายเหตุ:

- `test/golden/fixtures.json` คือ snapshot เป๊ะ ๆ ของ output จาก lib/ (รวมข้อความไทยและรหัสสี) — ถ้าตั้งใจแก้ lib/ ให้รัน `npm run fixtures` แล้ว review diff ก่อน commit; Phase 2 ใช้ไฟล์เดียวกันนี้เป็น golden reference ฝั่ง Rust
- debounced store-set ฝั่ง Electron อาจเสีย write ช่วง ≤300ms สุดท้ายถ้าแอป crash แรง ๆ — ยอมรับได้เพราะเป็น settings/cache
