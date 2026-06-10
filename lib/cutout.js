// cutout.js — ตัดพื้นหลังขาวของรูปสินค้า (white-background product shots).
// Pure module: no DOM — works on a plain {width, height, data} RGBA buffer so the
// caller (panel.js) extracts ImageData from a canvas and passes it in.
//
// cutoutWhiteBg: flood-fill near-white pixels connected to ANY of the four edges
// and set their alpha to 0. White pixels enclosed INSIDE the product (e.g. a
// highlight or label) are untouched — they're not edge-connected. Iterative
// stack-based fill (images are 1M+ px; recursion would blow the stack).

/**
 * @param {{width:number, height:number, data:Uint8ClampedArray}} imageData RGBA, mutated in place
 * @param {{threshold?:number, feather?:number}} [opts] threshold: r,g,b all >= → "near-white";
 *   feather > 0: boundary pixels touching a cleared pixel get alpha *= 0.5 (soft edge)
 * @returns {{width:number, height:number, data:Uint8ClampedArray}} the same imageData
 */
export function cutoutWhiteBg(imageData, opts = {}) {
  const { threshold = 236, feather = 2 } = opts;
  const { width, height, data } = imageData;
  const isWhite = (p) => {
    const i = p * 4;
    return data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold;
  };

  // flood fill จากขอบทั้ง 4 ด้าน — mark เฉพาะ pixel ขาวที่ต่อถึงขอบ
  const cleared = new Uint8Array(width * height);
  const stack = [];
  const push = (p) => {
    if (!cleared[p] && isWhite(p)) { cleared[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < (height - 1) * width) push(p + width);
  }

  for (let p = 0; p < cleared.length; p++) {
    if (cleared[p]) data[p * 4 + 3] = 0;
  }

  // feather: ขอบสินค้า (pixel ที่ไม่โดนลบแต่ติดกับ pixel ที่ลบ) ลด alpha ลงครึ่ง
  if (feather > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (cleared[p]) continue;
        const touches =
          (x > 0 && cleared[p - 1]) || (x < width - 1 && cleared[p + 1]) ||
          (y > 0 && cleared[p - width]) || (y < height - 1 && cleared[p + width]);
        if (touches) data[p * 4 + 3] = Math.round(data[p * 4 + 3] * 0.5);
      }
    }
  }
  return imageData;
}

/**
 * Sample edge pixels — true ถ้า >70% near-white (รูปพื้นขาวที่ควร cutout).
 * @param {{width:number, height:number, data:Uint8ClampedArray}} imageData
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function isMostlyWhiteEdges(imageData, threshold = 236) {
  const { width, height, data } = imageData;
  let white = 0, total = 0;
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    total++;
    if (data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold) white++;
  };
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 64));
  for (let x = 0; x < width; x += stepX) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y += stepY) { sample(0, y); sample(width - 1, y); }
  return total > 0 && white / total > 0.7;
}

// ---- self-test: node lib/cutout.js ---- (guarded: เบราว์เซอร์ไม่มี `process`)
if (typeof process !== 'undefined' && process.argv?.[1]?.replace(/\\/g, '/').endsWith('cutout.js')) {
  // 20x20 ขาวล้วน + สี่เหลี่ยมแดง 8x8 กลางภาพ (6..13) + รูขาว 2x2 ในสี่เหลี่ยม (9..10)
  const W = 20, H = 20;
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, r, g, b) => {
    const i = (y * W + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 255, 255, 255);
  for (let y = 6; y <= 13; y++) for (let x = 6; x <= 13; x++) set(x, y, 200, 20, 20);
  for (let y = 9; y <= 10; y++) for (let x = 9; x <= 10; x++) set(x, y, 255, 255, 255);

  const img = { width: W, height: H, data };
  const whiteEdges = isMostlyWhiteEdges(img);
  cutoutWhiteBg(img);
  const alpha = (x, y) => data[(y * W + x) * 4 + 3];

  const checks = [
    ['isMostlyWhiteEdges = true', whiteEdges === true],
    ['corners alpha 0', alpha(0, 0) === 0 && alpha(W - 1, 0) === 0 && alpha(0, H - 1) === 0 && alpha(W - 1, H - 1) === 0],
    ['red square alpha 255', alpha(7, 7) === 255 && alpha(12, 12) === 255 && alpha(8, 10) === 255],
    ['enclosed white hole alpha 255', alpha(9, 9) === 255 && alpha(10, 10) === 255],
  ];
  let pass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (!ok) pass = false;
  }
  process.exit(pass ? 0 : 1);
}
