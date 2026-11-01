"""Turn recorded frames into a GIF and an MP4, or one frame into a PNG.

Usage: python3 make.py SPEC.json [NAME ...]

SPEC holds one or more clips by name (all of them by default):

  {
    "hero": {
      "out": "../../docs/media/hero",  # writes hero.gif and hero.mp4
      "size": [1280, 800],             # output size; every crop has its shape
      "fps": 10,
      "parts": [                       # played in order
        {"frames": "/rec/hero", "from": 0, "to": 0,   # unix ms, both optional
         "crop": [x, y, w, h],         # frame pixels; default: the whole frame
         "seconds": 4},                # squeeze into N seconds; or "speed": 1
        {"zoom": [x, y, w, h], "seconds": 0.8},  # move the crop there, on
                                       # the frame shown last
        {..., "caption": "Pick a box", "step": 1}  # a label on that part
      ],
      "hold": 3                        # seconds the last frame stays
    },
    "data-model": {"out": "...", "size": [960, 600], "still": "/rec/x/1.png",
                   "crop": [x, y, w, h]}   # one PNG
  }

Paths are relative to the spec file. Needs ffmpeg and Pillow.
"""

import json
import subprocess
from functools import lru_cache
import sys
import tempfile
from pathlib import Path


def frames(part: dict, base: Path) -> list[tuple[Path, float]]:
    """(file, unix seconds) of a part's frames, in order."""
    found = []
    for f in (base / part["frames"]).glob("*.png"):
        ms = int(f.stem)
        if part.get("from", 0) <= ms <= part.get("to", 1 << 62):
            found.append((f, ms / 1000))
    return sorted(found, key=lambda x: x[1])


def shots(clip: dict, base: Path) -> list[tuple[Path, tuple, float, tuple]]:
    """(frame, crop, seconds on screen, caption) for the whole clip."""
    out: list[tuple[Path, tuple, float, tuple]] = []
    fps = clip.get("fps", 10)
    crop = None
    for part in clip["parts"]:
        if "zoom" in part:
            if not out:
                raise SystemExit("a zoom needs a frame before it")
            frame, start = out[-1][0], crop
            cap = (part.get("step"), part["caption"]) if "caption" in part else out[-1][3]
            steps = max(2, round(part["seconds"] * fps))
            for i in range(1, steps + 1):
                k = i / steps
                k = k * k * (3 - 2 * k)  # ease in and out
                out.append((frame, tuple(a + (b - a) * k for a, b in zip(start, part["zoom"])), 1 / fps, cap))
            crop = tuple(part["zoom"])
            continue
        got = frames(part, base)
        if not got:
            raise SystemExit(f"no frames in {part}")
        crop = tuple(part.get("crop", crop or (0, 0, 0, 0)))
        cap = (part.get("step"), part["caption"]) if "caption" in part else None
        real = (got[-1][1] - got[0][1]) or 1.0
        scale = part["seconds"] / real if "seconds" in part else 1.0 / part.get("speed", 1.0)
        nexts = [t for _, t in got[1:]] + [got[-1][1] + 1 / fps]
        for (f, t), nxt in zip(got, nexts):
            out.append((f, crop, (nxt - t) * scale, cap))
    if out:
        f, c, d, cap = out[-1]
        out[-1] = (f, c, d + clip.get("hold", 0), cap)
    return out


@lru_cache(maxsize=None)
def font(px: int, bold: bool = False):
    from PIL import ImageFont
    for f in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            face = ImageFont.truetype(f, px)
            if bold:
                try:
                    face.set_variation_by_name("Semibold")
                except Exception:
                    pass
            return face
        except OSError:
            continue
    return ImageFont.load_default()


def caption(img, step, text: str) -> None:
    """A label at the bottom left: the step number in a circle, then the text."""
    from PIL import ImageDraw
    w, h = img.size
    px = max(16, round(h * 0.034))
    f, fb = font(px), font(px, True)
    d = ImageDraw.Draw(img, "RGBA")
    pad, gap, r = round(px * 0.6), round(px * 0.5), round(px * 0.75)
    tw = d.textlength(text, font=f)
    bw = (2 * r + gap if step else 0) + tw + 2 * pad
    bh = 2 * r + round(px * 0.5)
    x0, y0 = round(h * 0.03), h - bh - round(h * 0.03)
    d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=bh // 2, fill=(25, 23, 36, 235), outline=(196, 167, 231, 255), width=2)
    cx = x0 + pad
    if step:
        cy = y0 + bh // 2
        d.ellipse((cx, cy - r, cx + 2 * r, cy + r), fill=(196, 167, 231, 255))
        d.text((cx + r, cy), str(step), font=fb, fill=(25, 23, 36, 255), anchor="mm")
        cx += 2 * r + gap
    d.text((cx, y0 + bh // 2), text, font=f, fill=(224, 222, 244, 255), anchor="lm")


def render(frame: Path, crop: tuple, size: tuple, dest: Path, cap=None) -> None:
    from PIL import Image
    img = Image.open(frame).convert("RGB")
    x, y, w, h = crop
    if w and h:
        img = img.crop((round(x), round(y), round(x + w), round(y + h)))
    img = img.resize(size, Image.LANCZOS)
    if cap:
        caption(img, *cap)
    img.save(dest)


def make(clip: dict, base: Path) -> None:
    out = (base / clip["out"]).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    size = tuple(clip["size"])
    if "still" in clip:
        cap = (clip.get("step"), clip["caption"]) if "caption" in clip else None
        render(base / clip["still"], tuple(clip.get("crop", (0, 0, 0, 0))), size, out.with_suffix(".png"), cap)
        return
    fps = clip.get("fps", 10)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        done: dict[tuple, Path] = {}
        seq = []  # the frame to show at each 1/fps tick
        clock = 0.0
        shown = 0
        for frame, crop, secs, cap in shots(clip, base):
            key = (frame, tuple(round(v) for v in crop), cap)
            if key not in done:
                done[key] = tmp / f"r{len(done):05d}.png"
                render(frame, crop, size, done[key], cap)
            clock += secs
            while shown < round(clock * fps):
                seq.append(done[key])
                shown += 1
        for i, f in enumerate(seq):
            (tmp / f"s{i:05d}.png").symlink_to(f)
        src = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "s%05d.png")]
        subprocess.run(src + ["-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out.with_suffix(".mp4"))],
                       check=True)
        palette = tmp / "palette.png"
        subprocess.run(src + ["-vf", "palettegen=stats_mode=diff", str(palette)], check=True)
        subprocess.run(src + ["-i", str(palette), "-lavfi", "paletteuse=dither=sierra2_4a:diff_mode=rectangle",
                              str(out.with_suffix(".gif"))], check=True)


def main() -> None:
    spec_path = Path(sys.argv[1]).resolve()
    spec = json.loads(spec_path.read_text())
    for name in sys.argv[2:] or list(spec):
        make(spec[name], spec_path.parent)
        print(f"made {name}")


if __name__ == "__main__":
    main()
