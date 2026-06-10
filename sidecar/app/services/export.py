"""Batch multi-size image export (Pillow).

Given one source image, export the standard promo sizes in one call:
  1080x1080 (LINE/IG square), 1080x1350 (IG portrait),
  1080x1920 (story), 1040x1040 (LINE rich message).

Strategy: cover-crop centered — scale so the image covers the target box,
then crop the overflow equally from both sides (like CSS object-fit: cover).
"""

from __future__ import annotations

import base64
import io

from PIL import Image

DEFAULT_SIZES: list[tuple[int, int]] = [
    (1080, 1080),
    (1080, 1350),
    (1080, 1920),
    (1040, 1040),
]

FORMATS = {"png": "PNG", "jpeg": "JPEG", "jpg": "JPEG", "webp": "WEBP"}


def cover_crop(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Scale-to-cover then center-crop to exactly (target_w, target_h)."""
    if target_w <= 0 or target_h <= 0:
        raise ValueError(f"Invalid target size {target_w}x{target_h}")
    src_w, src_h = img.size
    scale = max(target_w / src_w, target_h / src_h)
    new_w = max(target_w, round(src_w * scale))
    new_h = max(target_h, round(src_h * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def export_sizes(
    image_bytes: bytes,
    sizes: list[tuple[int, int]] | None = None,
    fmt: str = "png",
    quality: int = 90,
) -> list[dict]:
    """Export the source image to every requested size in one batch.

    Returns [{width, height, mime, base64}, ...] in the order of `sizes`.
    """
    fmt_key = (fmt or "png").lower()
    if fmt_key not in FORMATS:
        raise ValueError(f"Unsupported format: {fmt}")
    pil_fmt = FORMATS[fmt_key]
    mime = "image/jpeg" if pil_fmt == "JPEG" else f"image/{pil_fmt.lower()}"

    src = Image.open(io.BytesIO(image_bytes))
    # JPEG can't carry alpha — flatten onto white; PNG/WebP keep RGBA.
    if pil_fmt == "JPEG":
        if src.mode in ("RGBA", "LA", "P"):
            rgba = src.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[-1])
            src = bg
        else:
            src = src.convert("RGB")
    else:
        src = src.convert("RGBA")

    out: list[dict] = []
    for w, h in sizes or DEFAULT_SIZES:
        variant = cover_crop(src, int(w), int(h))
        buf = io.BytesIO()
        save_kwargs = {"quality": quality} if pil_fmt in ("JPEG", "WEBP") else {}
        variant.save(buf, format=pil_fmt, **save_kwargs)
        out.append(
            {
                "width": int(w),
                "height": int(h),
                "mime": mime,
                "base64": base64.b64encode(buf.getvalue()).decode("ascii"),
            }
        )
    return out
