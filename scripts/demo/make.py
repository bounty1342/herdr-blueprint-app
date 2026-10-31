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
        {"zoom": [x, y, w, h], "seconds": 0.8}   # move the crop there, on
                                       # the frame shown last
      ],
      "hold": 3                        # seconds the last frame stays
    },
    "data-model": {"out": "...", "size": [960, 600], "still": "/rec/x/1.png",
                   "crop": [x, y, w, h]}   # one PNG
  }

Paths are relative to the spec file. Needs ffmpeg.
"""

import json
import subprocess
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


def shots(clip: dict, base: Path) -> list[tuple[Path, tuple, float]]:
    """(frame, crop, seconds on screen) for the whole clip."""
    out: list[tuple[Path, tuple, float]] = []
    fps = clip.get("fps", 10)
    crop = None
    for part in clip["parts"]:
        if "zoom" in part:
            if not out:
                raise SystemExit("a zoom needs a frame before it")
            frame, start = out[-1][0], crop
            steps = max(2, round(part["seconds"] * fps))
            for i in range(1, steps + 1):
                k = i / steps
                k = k * k * (3 - 2 * k)  # ease in and out
                out.append((frame, tuple(a + (b - a) * k for a, b in zip(start, part["zoom"])), 1 / fps))
            crop = tuple(part["zoom"])
            continue
        got = frames(part, base)
        if not got:
            raise SystemExit(f"no frames in {part}")
        crop = tuple(part.get("crop", crop or (0, 0, 0, 0)))
        real = (got[-1][1] - got[0][1]) or 1.0
        scale = part["seconds"] / real if "seconds" in part else 1.0 / part.get("speed", 1.0)
        nexts = [t for _, t in got[1:]] + [got[-1][1] + 1 / fps]
        for (f, t), nxt in zip(got, nexts):
            out.append((f, crop, (nxt - t) * scale))
    if out:
        f, c, d = out[-1]
        out[-1] = (f, c, d + clip.get("hold", 0))
    return out


def render(frame: Path, crop: tuple, size: tuple, dest: Path) -> None:
    vf = []
    x, y, w, h = (round(v) for v in crop)
    if w and h:
        vf.append(f"crop={w}:{h}:{x}:{y}")
    vf.append(f"scale={size[0]}:{size[1]}:flags=lanczos")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(frame), "-vf", ",".join(vf), str(dest)],
                   check=True)


def make(clip: dict, base: Path) -> None:
    out = (base / clip["out"]).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    size = tuple(clip["size"])
    if "still" in clip:
        render(base / clip["still"], tuple(clip.get("crop", (0, 0, 0, 0))), size, out.with_suffix(".png"))
        return
    fps = clip.get("fps", 10)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        done: dict[tuple, Path] = {}
        seq = []  # the frame to show at each 1/fps tick
        clock = 0.0
        shown = 0
        for frame, crop, secs in shots(clip, base):
            key = (frame, tuple(round(v) for v in crop))
            if key not in done:
                done[key] = tmp / f"r{len(done):05d}.png"
                render(frame, crop, size, done[key])
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
