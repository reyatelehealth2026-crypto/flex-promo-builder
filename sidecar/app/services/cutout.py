"""Background cutout — port of lib/cutout.js.

cutout_white_bg: flood-fill near-white pixels connected to ANY of the four
edges and set their alpha to 0. White pixels enclosed INSIDE the product
(e.g. a highlight or label) are untouched — they're not edge-connected.
Iterative stack-based fill (images are 1M+ px; recursion would blow the stack).

Two layers:
- pixel-level functions operating on a flat RGBA bytearray (mirrors the JS
  Uint8ClampedArray API, used by tests ported from lib/cutout.js self-test)
- Pillow helpers (cutout_image / should_cutout) used by the HTTP endpoint
"""

from __future__ import annotations

import io
from PIL import Image


def cutout_white_bg(width: int, height: int, data: bytearray, threshold: int = 236, feather: int = 2) -> bytearray:
    """Mutates `data` (flat RGBA, len == width*height*4) in place and returns it.

    threshold: r,g,b all >= threshold counts as "near-white".
    feather > 0: boundary pixels touching a cleared pixel get alpha *= 0.5.
    """

    def is_white(p: int) -> bool:
        i = p * 4
        return data[i] >= threshold and data[i + 1] >= threshold and data[i + 2] >= threshold

    # flood fill จากขอบทั้ง 4 ด้าน — mark เฉพาะ pixel ขาวที่ต่อถึงขอบ
    cleared = bytearray(width * height)
    stack: list[int] = []

    def push(p: int) -> None:
        if not cleared[p] and is_white(p):
            cleared[p] = 1
            stack.append(p)

    for x in range(width):
        push(x)
        push((height - 1) * width + x)
    for y in range(height):
        push(y * width)
        push(y * width + width - 1)

    last_row_start = (height - 1) * width
    while stack:
        p = stack.pop()
        x = p % width
        if x > 0:
            push(p - 1)
        if x < width - 1:
            push(p + 1)
        if p >= width:
            push(p - width)
        if p < last_row_start:
            push(p + width)

    for p in range(width * height):
        if cleared[p]:
            data[p * 4 + 3] = 0

    # feather: ขอบสินค้า (pixel ที่ไม่โดนลบแต่ติดกับ pixel ที่ลบ) ลด alpha ลงครึ่ง
    if feather > 0:
        for y in range(height):
            row = y * width
            for x in range(width):
                p = row + x
                if cleared[p]:
                    continue
                touches = (
                    (x > 0 and cleared[p - 1])
                    or (x < width - 1 and cleared[p + 1])
                    or (y > 0 and cleared[p - width])
                    or (y < height - 1 and cleared[p + width])
                )
                if touches:
                    data[p * 4 + 3] = round(data[p * 4 + 3] * 0.5)
    return data


def is_mostly_white_edges(width: int, height: int, data: bytearray | bytes, threshold: int = 236) -> bool:
    """Sample edge pixels — True ถ้า >70% near-white (รูปพื้นขาวที่ควร cutout)."""
    white = 0
    total = 0

    def sample(x: int, y: int) -> None:
        nonlocal white, total
        i = (y * width + x) * 4
        total += 1
        if data[i] >= threshold and data[i + 1] >= threshold and data[i + 2] >= threshold:
            white += 1

    step_x = max(1, width // 64)
    step_y = max(1, height // 64)
    for x in range(0, width, step_x):
        sample(x, 0)
        sample(x, height - 1)
    for y in range(0, height, step_y):
        sample(0, y)
        sample(width - 1, y)
    return total > 0 and white / total > 0.7


# ---- Pillow wrappers (HTTP layer) -------------------------------------------

def should_cutout(img: Image.Image, threshold: int = 236) -> bool:
    rgba = img.convert("RGBA")
    return is_mostly_white_edges(rgba.width, rgba.height, rgba.tobytes(), threshold)


def cutout_image(img: Image.Image, threshold: int = 236, feather: int = 2) -> Image.Image:
    """Run the white-background cutout on a Pillow image; returns a new RGBA image."""
    rgba = img.convert("RGBA")
    data = bytearray(rgba.tobytes())
    cutout_white_bg(rgba.width, rgba.height, data, threshold=threshold, feather=feather)
    return Image.frombytes("RGBA", (rgba.width, rgba.height), bytes(data))


def cutout_png_bytes(png_bytes: bytes, threshold: int = 236, feather: int = 2,
                     only_if_white_edges: bool = False) -> tuple[bytes, bool]:
    """Cutout from encoded image bytes -> (png_bytes, applied).

    only_if_white_edges: skip the cutout when the edges are not mostly white
    (mirrors the panel.js behavior of auto-detecting product shots).
    """
    img = Image.open(io.BytesIO(png_bytes))
    if only_if_white_edges and not should_cutout(img, threshold):
        out = io.BytesIO()
        img.convert("RGBA").save(out, format="PNG")
        return out.getvalue(), False
    result = cutout_image(img, threshold=threshold, feather=feather)
    out = io.BytesIO()
    result.save(out, format="PNG")
    return out.getvalue(), True
