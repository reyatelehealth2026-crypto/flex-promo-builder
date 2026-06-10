# TODO — Prom9 Migration

## Phase 1 — Stabilize Electron (~1 สัปดาห์)

- [x] สร้าง golden fixtures จาก flex-builder.js จริง
- [x] เก็บ gen-fixtures.mjs + fixtures.json เข้า repo ที่ test/golden/
- [x] เพิ่ม `"type": "module"` ใน package.json (ลด warning + overhead ตอน parse)
- [x] Debounce search ที่ panel.js:254 (~150ms)
- [x] แยก state + pure functions ออกจาก panel.js เป็น sidepanel/state.js (ไม่แตะ DOM code)
- [x] เปลี่ยน store-set เป็น debounced write (ไม่เขียนไฟล์ทุก keystroke)

## Phase 2 — Rust Core (3–4 สัปดาห์)

- [x] สร้าง crate prom9_core (workspace layout: flex/, ingest/, creative/)
- [x] Port flex-builder.js → flex/builder.rs (5 templates: classic, promo, bigprice, minimal, urgent)
- [x] Replicate money() float-taming ให้เป๊ะ (test case float-edge ใน fixtures)
- [x] Port validate.js → flex/validate.rs (12 bubbles, 50KB, https check, label ≤20)
- [x] Golden test: อ่าน fixtures.json → canonical JSON → assert match ทุก case
- [x] Port adapters.js + cny.js + promo.js → ingest/
- [x] Port compositor.js → creative/ (draw-plan struct)

## Phase 3 — Flutter Prototype (4 สัปดาห์)

- [x] Scaffold project ตามโครง features/ + ติดตั้ง flutter_rust_bridge v2
- [x] เชื่อม prom9_core ผ่าน FFI + generate Dart models
- [x] Product Hub: list (ListView.builder) + search + filter + multi-select
- [x] SQLite + FTS5 สำหรับ search 10k SKU
- [x] Flex preview widget (render bubble JSON เป็น Flutter widget)
- [x] Export Flex JSON + validation UI
- [x] Card renderer ด้วย CustomPainter จาก compositor draw-plan (แทน offscreen Chromium → batch ขนานได้)

## Phase 4 — AI + Creative (4–6 สัปดาห์)

- [x] Python sidecar (FastAPI local) แทน bridge/server.cjs
- [x] ย้าย AI content / imagegen / cutout ไป sidecar
- [x] Prompt kit UI (port promptkit.js)
- [x] Export ภาพหลายขนาด (1080², 1080×1350, 1080×1920, 1040²) แบบ batch
- [x] ระบบตรวจคำเสี่ยงด้านสุขภาพ (rule-based ก่อน)

---

หมายเหตุ:

- `test/golden/fixtures.json` คือ snapshot เป๊ะ ๆ ของ output จาก lib/ (รวมข้อความไทยและรหัสสี) — ถ้าตั้งใจแก้ lib/ ให้รัน `npm run fixtures` แล้ว review diff ก่อน commit; Phase 2 ใช้ไฟล์เดียวกันนี้เป็น golden reference ฝั่ง Rust
- debounced store-set ฝั่ง Electron อาจเสีย write ช่วง ≤300ms สุดท้ายถ้าแอป crash แรง ๆ — ยอมรับได้เพราะเป็น settings/cache
- Phase 2 อยู่ที่ `prom9_core/` (`cargo test` = golden + parity + unit ครบ), Phase 3 อยู่ที่ `app/` (ฝั่ง Rust bridge ผ่าน `cargo check` แล้ว ส่วน Dart ต้อง build บนเครื่องที่มี Flutter SDK + รัน frb codegen — ดูขั้นตอนใน `app/README.md`), Phase 4 อยู่ที่ `sidecar/` (`pytest` 120 เคส, รันด้วย uvicorn พอร์ตเดิม 8765 แทน bridge/server.cjs ได้เลย)
