"""Record the demo window: `herdr-app shot` in a loop, one PNG per frame.

Usage: python3 record.py DIR [FPS]

Frames land in DIR as <unix ms>.png. It stops when DIR/stop exists. DIR/fps,
when present, overrides FPS while it runs (write 1 while an agent works for
minutes, 10 again for the part people should see move). Run it with the
demo's environment (env.sh) so it shoots the demo window.
"""

import subprocess
import sys
import time
from pathlib import Path


def main() -> None:
    out = Path(sys.argv[1])
    fps = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
    out.mkdir(parents=True, exist_ok=True)
    (out / "stop").unlink(missing_ok=True)
    while not (out / "stop").exists():
        try:
            fps = float((out / "fps").read_text())
        except (OSError, ValueError):
            pass
        start = time.time()
        subprocess.run(["herdr-app", "shot", str(out / f"{int(start * 1000)}.png")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(max(0.0, 1.0 / fps - (time.time() - start)))


if __name__ == "__main__":
    main()
