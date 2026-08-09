"""Assemble PNG frames into docs/demo.gif.

Called by `docs/record.mjs`, which does the interesting half — driving the app
and recording it. This half is only here because Playwright's bundled ffmpeg is
built with `--disable-everything` and has no GIF encoder, so something has to
turn frames into a palette.

    python3 docs/gif.py <frames-dir> <out.gif> <fps> <colors>

Two things keep the file small enough to commit, and both matter more than the
encoder settings:

* **Runs of identical frames collapse into one.** A UI demo is mostly stillness
  — three seconds of a results page while the reader takes it in is thirty
  identical frames. They become one frame with a three-second delay, which is
  the same picture at a fraction of the bytes.
* **One palette for the whole animation.** Per-frame palettes make every frame a
  local optimum and force a new colour table into each one; a single table
  computed across the whole recording is both smaller and stabler, with no
  colour shift when the page scrolls.
"""

import sys
from pathlib import Path

from PIL import Image, ImageChops

# Fraction of pixels that may differ before two frames count as different.
#
# Not zero: VP8 is lossy, so a still page can decode with a few pixels of noise,
# and treating those as motion would defeat the whole collapse. But the ceiling
# is low, and set by the smallest change worth keeping rather than by the noise
# floor: one typed character is roughly 30-60 pixels at this scale, so anything
# above that threshold quietly eats the typing and turns a field being filled
# into a field that jumps. At 800x500 this is about 24 pixels.
NOISE = 0.00006


def different(a: Image.Image, b: Image.Image) -> bool:
    diff = ImageChops.difference(a, b)
    if diff.getbbox() is None:
        return False
    # Count the pixels that moved by more than a hair. Done as a histogram over
    # a thresholded band rather than a Python loop over 400k pixels — the loop
    # is the difference between this step taking a second and taking a minute.
    changed = diff.convert("L").point(lambda v: 255 if v > 12 else 0).histogram()[255]
    return changed > NOISE * a.width * a.height


def main() -> int:
    frames_dir, out, fps, colors = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    paths = sorted(Path(frames_dir).glob("*.png"))
    if not paths:
        print("no frames to assemble", file=sys.stderr)
        return 1

    tick = round(1000 / fps)
    frames: list[Image.Image] = []
    delays: list[int] = []

    for path in paths:
        image = Image.open(path).convert("RGB")
        if frames and not different(frames[-1], image):
            delays[-1] += tick
            continue
        frames.append(image)
        delays.append(tick)

    # One palette, computed from the frames that survived the collapse rather
    # than from every duplicate, so long still beats do not dominate it.
    sample = Image.new("RGB", (frames[0].width, frames[0].height * len(frames)))
    for index, frame in enumerate(frames):
        sample.paste(frame, (0, index * frames[0].height))
    palette = sample.convert("P", palette=Image.Palette.ADAPTIVE, colors=colors)

    quantized = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]

    quantized[0].save(
        out,
        save_all=True,
        append_images=quantized[1:],
        duration=delays,
        loop=0,
        optimize=True,
        disposal=1,
    )

    kept, total = len(frames), len(paths)
    seconds = sum(delays) / 1000
    size = Path(out).stat().st_size / 1_000_000
    print(f"{out}: {kept}/{total} frames, {seconds:.1f}s, {size:.2f} MB, {colors} colours")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
