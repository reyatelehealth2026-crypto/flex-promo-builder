"""Tests for app/services/export.py — batch multi-size export with Pillow."""

import base64
import io

import pytest
from PIL import Image

from app.services import export


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def decode(result: dict) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(result["base64"])))


def test_default_batch_sizes():
    src = png_bytes(Image.new("RGB", (2000, 2000), (200, 30, 30)))
    results = export.export_sizes(src)
    dims = [(r["width"], r["height"]) for r in results]
    assert dims == [(1080, 1080), (1080, 1350), (1080, 1920), (1040, 1040)]
    for r in results:
        img = decode(r)
        assert img.size == (r["width"], r["height"])
        assert r["mime"] == "image/png"


def test_cover_crop_covers_wide_source():
    # 2000x500 source into 1080x1920: must scale by height then crop width.
    src = png_bytes(Image.new("RGB", (2000, 500), (10, 200, 10)))
    (result,) = export.export_sizes(src, sizes=[(1080, 1920)])
    assert decode(result).size == (1080, 1920)


def test_center_crop_keeps_middle():
    # Top half red, bottom half blue; 100x200 -> 100x100 takes the vertical middle,
    # so the result is still red on top, blue on bottom.
    img = Image.new("RGB", (100, 200))
    for y in range(200):
        for x in range(100):
            img.putpixel((x, y), (255, 0, 0) if y < 100 else (0, 0, 255))
    (result,) = export.export_sizes(png_bytes(img), sizes=[(100, 100)])
    out = decode(result).convert("RGB")
    r_top = out.getpixel((50, 10))
    b_bottom = out.getpixel((50, 90))
    assert r_top[0] > 200 and r_top[2] < 50, f"expected red top, got {r_top}"
    assert b_bottom[2] > 200 and b_bottom[0] < 50, f"expected blue bottom, got {b_bottom}"


def test_jpeg_flattens_alpha_and_sets_mime():
    rgba = Image.new("RGBA", (300, 300), (255, 0, 0, 0))  # fully transparent
    (result,) = export.export_sizes(png_bytes(rgba), sizes=[(100, 100)], fmt="jpeg")
    assert result["mime"] == "image/jpeg"
    out = decode(result)
    assert out.mode == "RGB"
    px = out.getpixel((50, 50))
    assert all(c > 240 for c in px), f"transparent should flatten to white, got {px}"


def test_png_preserves_alpha():
    rgba = Image.new("RGBA", (300, 300), (0, 255, 0, 128))
    (result,) = export.export_sizes(png_bytes(rgba), sizes=[(150, 150)])
    out = decode(result)
    assert out.mode == "RGBA"
    assert out.getpixel((75, 75))[3] == 128


def test_upscales_small_source():
    src = png_bytes(Image.new("RGB", (50, 50), (1, 2, 3)))
    (result,) = export.export_sizes(src, sizes=[(1040, 1040)])
    assert decode(result).size == (1040, 1040)


def test_unsupported_format_raises():
    src = png_bytes(Image.new("RGB", (10, 10)))
    with pytest.raises(ValueError, match="Unsupported format"):
        export.export_sizes(src, fmt="bmp")


def test_invalid_size_raises():
    src = png_bytes(Image.new("RGB", (10, 10)))
    with pytest.raises(ValueError, match="Invalid target size"):
        export.export_sizes(src, sizes=[(0, 100)])
