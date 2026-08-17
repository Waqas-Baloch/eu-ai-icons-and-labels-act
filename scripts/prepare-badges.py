#!/usr/bin/env python3
"""
Turns the official EU icon pack into the web assets the app ships.

Two things happen here, and the first one matters more than it looks:

1. TRIM. The supplied PNGs carry a large transparent margin — the "AI
   GENERATED" artwork is a 7459x2363 canvas holding roughly 5800x1120 of
   actual ink, so over half the height is empty space. Left in place, every
   measurement in the app is wrong in the same invisible way: the 20px
   storefront keep-out is measured from the empty canvas edge rather than the
   visible label, the height percentage sizes the padding as well as the mark,
   and the editor's selection box floats a long way off the artwork. Trimming
   to the ink bounds makes the image box mean what it looks like it means.

2. RESIZE to a web-appropriate height, preserving aspect.

The original pack is never modified. Requires Pillow:  pip install Pillow
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (
    ROOT.parent
    / "LABEL_AI_GENERATED_PNG_544xjpnR3CO6yyOLgQZM1Qp4Qg_129547"
)
DEST = ROOT / "extensions" / "ai-disclosure" / "assets"

# Tall enough to stay crisp when the badge is sized at the top of its range on
# a large product photo, small enough to stay a trivial download.
TARGET_HEIGHT = 200

# source filename -> shipped filename
MAPPING = {
    "LABEL_AI GENERATED_black transparent.png": "eu-ai-generated-black.png",
    "LABEL_AI GENERATED_white transparent.png": "eu-ai-generated-white.png",
    "LABEL_AI GENERATED_black.png": "eu-ai-generated-black-solid.png",
    "LABEL_AI GENERATED_white.png": "eu-ai-generated-white-solid.png",
    "LABEL_AI MODIFIED_black transparent.png": "eu-ai-modified-black.png",
    "LABEL_AI MODIFIED_white transparent.png": "eu-ai-modified-white.png",
    "LABEL_AI MODIFIED_black.png": "eu-ai-modified-black-solid.png",
    "LABEL_AI MODIFIED_white.png": "eu-ai-modified-white-solid.png",
    "LABEL_AI_black transparent.png": "eu-ai-black.png",
    "LABEL_AI_white transparent.png": "eu-ai-white.png",
    "LABEL_AI_black.png": "eu-ai-black-solid.png",
    "LABEL_AI_white.png": "eu-ai-white-solid.png",
}


def ink_bounds(image: Image.Image):
    """
    Bounding box of the visible mark.

    Uses the alpha channel where the artwork is transparent-backed. The solid
    variants sit on an opaque plate, so alpha covers the whole canvas and we
    fall back to finding the non-white region instead.
    """
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box and alpha_box != (0, 0, *image.size):
        return alpha_box

    # Opaque artwork: locate whatever differs from the corner colour.
    background = image.convert("RGB").getpixel((0, 0))
    diff = Image.new("L", image.size, 0)
    rgb = image.convert("RGB")
    diff.putdata(
        [
            255 if max(abs(p[i] - background[i]) for i in range(3)) > 12 else 0
            for p in rgb.getdata()
        ]
    )
    return diff.getbbox() or (0, 0, *image.size)


def main() -> None:
    if not SOURCE.is_dir():
        sys.exit(f"Source icon pack not found at {SOURCE}")
    DEST.mkdir(parents=True, exist_ok=True)

    for source_name, dest_name in MAPPING.items():
        source_path = SOURCE / source_name
        if not source_path.is_file():
            print(f"  missing: {source_name}")
            continue

        image = Image.open(source_path).convert("RGBA")
        before = image.size
        image = image.crop(ink_bounds(image))

        width = max(1, round(image.width * TARGET_HEIGHT / image.height))
        image = image.resize((width, TARGET_HEIGHT), Image.LANCZOS)
        image.save(DEST / dest_name, optimize=True)

        print(
            f"  {dest_name:34} {before[0]}x{before[1]} -> {image.width}x{image.height}"
        )

    print(f"\nWrote {len(MAPPING)} badges to {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
