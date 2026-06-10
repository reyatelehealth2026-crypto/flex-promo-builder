"""Tests for app/services/cutout.py — ported from the lib/cutout.js self-test."""

import io

from PIL import Image

from app.services import cutout

W, H = 20, 20


def make_test_buffer() -> bytearray:
    """20x20 ขาวล้วน + สี่เหลี่ยมแดง 8x8 กลางภาพ (6..13) + รูขาว 2x2 ในสี่เหลี่ยม (9..10)."""
    data = bytearray(W * H * 4)

    def set_px(x, y, r, g, b):
        i = (y * W + x) * 4
        data[i : i + 4] = bytes([r, g, b, 255])

    for y in range(H):
        for x in range(W):
            set_px(x, y, 255, 255, 255)
    for y in range(6, 14):
        for x in range(6, 14):
            set_px(x, y, 200, 20, 20)
    for y in range(9, 11):
        for x in range(9, 11):
            set_px(x, y, 255, 255, 255)
    return data


def alpha(data, x, y):
    return data[(y * W + x) * 4 + 3]


def test_is_mostly_white_edges_true():
    assert cutout.is_mostly_white_edges(W, H, make_test_buffer()) is True


def test_is_mostly_white_edges_false_for_dark():
    data = bytearray(b"\x10\x10\x10\xff" * (W * H))
    assert cutout.is_mostly_white_edges(W, H, data) is False


def test_cutout_clears_edge_connected_white_only():
    data = make_test_buffer()
    cutout.cutout_white_bg(W, H, data)
    # corners alpha 0
    assert alpha(data, 0, 0) == 0
    assert alpha(data, W - 1, 0) == 0
    assert alpha(data, 0, H - 1) == 0
    assert alpha(data, W - 1, H - 1) == 0
    # red square alpha 255 (interior, away from feathered boundary)
    assert alpha(data, 7, 7) == 255 or alpha(data, 8, 8) == 255
    assert alpha(data, 12, 12) == 255 or alpha(data, 11, 11) == 255
    assert alpha(data, 8, 10) == 255
    # enclosed white hole untouched (not edge-connected)
    assert alpha(data, 9, 9) == 255
    assert alpha(data, 10, 10) == 255


def test_feather_halves_boundary_alpha():
    data = make_test_buffer()
    cutout.cutout_white_bg(W, H, data, feather=2)
    # (6,6) is a red pixel touching cleared white -> alpha halved
    assert alpha(data, 6, 6) == 128


def test_no_feather_keeps_boundary_opaque():
    data = make_test_buffer()
    cutout.cutout_white_bg(W, H, data, feather=0)
    assert alpha(data, 6, 6) == 255


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_cutout_png_bytes_roundtrip():
    img = Image.frombytes("RGBA", (W, H), bytes(make_test_buffer()))
    out_bytes, applied = cutout.cutout_png_bytes(_png_bytes(img))
    assert applied is True
    out = Image.open(io.BytesIO(out_bytes)).convert("RGBA")
    assert out.getpixel((0, 0))[3] == 0          # bg cleared
    assert out.getpixel((8, 10))[3] == 255       # product kept
    assert out.getpixel((9, 9))[3] == 255        # enclosed hole kept


def test_cutout_png_bytes_auto_skips_non_white_bg():
    dark = Image.new("RGBA", (W, H), (10, 10, 10, 255))
    out_bytes, applied = cutout.cutout_png_bytes(_png_bytes(dark), only_if_white_edges=True)
    assert applied is False
    out = Image.open(io.BytesIO(out_bytes)).convert("RGBA")
    assert out.getpixel((0, 0))[3] == 255  # untouched
