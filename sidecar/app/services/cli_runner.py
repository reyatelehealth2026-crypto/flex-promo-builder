"""CLI runners — port of the subprocess logic in bridge/server.cjs.

- run_claude(prompt):  shells out to `claude -p`, feeding the prompt via stdin
  (avoids the ~8KB Windows command-line limit — flex carousels are large).
  Uses the user's existing Claude Code login — no API key.
- run_codex_image(prompt, ref_path): generates an image FOR FREE via
  `codex exec` (the user's Codex/ChatGPT login). codex saves to
  ~/.codex/generated_images/<id>/ig_*.png; we return the newest png produced
  by this run.
"""

from __future__ import annotations

import base64
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

CODEX_IMAGES_DIR = Path.home() / ".codex" / "generated_images"

# Long ceilings: model/image generation can take minutes; the bridge had none,
# but a stuck subprocess shouldn't wedge the sidecar forever.
CLAUDE_TIMEOUT_S = 600
CODEX_TIMEOUT_S = 600


class CliError(RuntimeError):
    pass


def newest_png(directory: Path) -> tuple[Path, float] | None:
    """Find the newest .png anywhere under a directory tree."""
    best: tuple[Path, float] | None = None
    if not directory.is_dir():
        return None
    for p in directory.rglob("*"):
        try:
            if p.is_file() and p.suffix.lower() == ".png":
                mtime = p.stat().st_mtime
                if best is None or mtime > best[1]:
                    best = (p, mtime)
        except OSError:
            continue
    return best


def run_claude(prompt: str) -> str:
    """Run `claude -p` with the prompt on stdin; returns stdout text."""
    try:
        proc = subprocess.run(
            ["claude", "-p"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT_S,
        )
    except FileNotFoundError as e:
        raise CliError(f"spawn claude failed: {e} (claude อยู่ใน PATH ไหม?)") from e
    except subprocess.TimeoutExpired as e:
        raise CliError("claude timed out") from e
    if proc.returncode != 0:
        raise CliError(proc.stderr.strip() or f"claude exited {proc.returncode}")
    return proc.stdout


def write_ref_image(ref_base64: str | None) -> str | None:
    """Persist a base64 reference image to a temp PNG; returns the path (or None)."""
    if not ref_base64:
        return None
    try:
        fd, path = tempfile.mkstemp(prefix="flexref-", suffix=".png")
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(ref_base64))
        return path
    except Exception:
        return None


def run_codex_image(prompt: str, ref_path: str | None = None) -> dict:
    """Generate an image via `codex exec`; returns {"base64": ..., "mime": "image/png"}."""
    before = newest_png(CODEX_IMAGES_DIR)
    before_mtime = before[1] if before else 0.0

    ref_line = (
        f'Use the image at "{ref_path}" as a visual reference for composition, subject, and colors. '
        if ref_path
        else ""
    )
    stdin_text = (
        f"Use your built-in image generation tool to create this image (do NOT write code to draw it): {prompt}\n"
        + ref_line
        + "Generate one PNG image. After generating, reply with just the file path."
    )

    try:
        proc = subprocess.run(
            ["codex", "exec", "--skip-git-repo-check"],
            input=stdin_text,
            capture_output=True,
            text=True,
            timeout=CODEX_TIMEOUT_S,
        )
    except FileNotFoundError as e:
        raise CliError(f"spawn codex failed: {e} (codex อยู่ใน PATH ไหม?)") from e
    except subprocess.TimeoutExpired as e:
        raise CliError("codex timed out") from e

    err = proc.stderr or ""
    # Give the filesystem a beat to settle, then look for a fresh png.
    time.sleep(0.05)
    after = newest_png(CODEX_IMAGES_DIR)
    if after and after[1] > before_mtime:
        data = after[0].read_bytes()
        return {"base64": base64.b64encode(data).decode("ascii"), "mime": "image/png"}

    last_err = (err.strip().splitlines() or [""])[-1]
    authish = re.search(r"401|unauthor|logged in|missing bearer|login", err, re.IGNORECASE)
    raise CliError(
        'codex ยังไม่ได้ login (CLI) — รัน "codex login" ในเทอร์มินอลแล้วเช็ค "codex login status" ให้ขึ้น logged in ก่อน'
        if authish
        else (last_err or "codex ไม่ได้สร้างรูป (เช็ค codex login / โควต้า)")
    )
