#!/usr/bin/env python3
"""
Generates the Shopify App Store brand assets.

  logo-mark.png     512x512    the mark alone, transparent
  app-icon.png      1200x1200  listing icon
  app-icon-48.png   48x48      legibility proof, not uploaded
  logo-wide.png     1600x400   wordmark lockup
  banner.png        1600x900   listing feature image
  product-carrots.png 900x900  sample product shot used in the banner

Flat, geometric, one strong blue. The mark is two separate shapes: a block
standing in for a product image, and a pill beneath it standing in for the
label the app places. It carries no letterform, so it stays readable at 48px
where a wordmark would not.

Deliberately not EU flag blue, and no star motif. The app ships the Union's own
icon pack; borrowing its visual identity on top of that would suggest an
endorsement that does not exist — the same claim the terms exist to disclaim.

Requires Pillow:  pip install Pillow
"""

import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
BADGES = ROOT / "extensions" / "ai-disclosure" / "assets"
OUT = ROOT / "brand"
OUT.mkdir(exist_ok=True)

BLUE = (43, 92, 246)
BLUE_DEEP = (30, 68, 200)
WHITE = (255, 255, 255)
MIST = (201, 216, 255)

# Product-shot palette
BACKDROP = (242, 239, 233)
CARROT = (232, 122, 34)
CARROT_DARK = (198, 96, 22)
CARROT_LIGHT = (247, 156, 74)
LEAF = (62, 138, 74)
LEAF_DARK = (44, 106, 56)

AVENIR = "/System/Library/Fonts/Avenir Next.ttc"
IDX_DEMI, IDX_MEDIUM, IDX_REGULAR = 2, 5, 7


def font(index: int, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(AVENIR, size, index=index)
    except OSError:
        return ImageFont.load_default()


def text_width(draw, text, f) -> int:
    box = draw.textbbox((0, 0), text, font=f)
    return box[2] - box[0]


# --------------------------------------------------------------------------
# The mark
# --------------------------------------------------------------------------

def draw_mark(canvas: Image.Image, box, fg, bg=None):
    """
    Two separate shapes: a block standing in for a product image, and a pill
    below-left of it standing in for the label the app places.

    They are drawn apart with clear space between rather than one punched out
    of the other. A knockout reads as a toggle or a button; two elements in
    tension read as a mark, and the silhouette survives being scaled to a
    48px list row because neither shape has a thin stroke.

    `bg` is unused and accepted only so callers can stay uniform.
    """
    x, y, size = box
    d = ImageDraw.Draw(canvas)

    def px(a: float) -> int:
        return int(round(a * size))

    # The image block: heavily rounded on the top-left, square elsewhere, so
    # the silhouette is asymmetric enough to be recognisable.
    d.rounded_rectangle(
        [x + px(0.26), y, x + size, y + px(0.74)],
        radius=px(0.30),
        fill=fg,
        corners=(True, False, False, False),
    )

    # The label: a pill tucked under the block's left edge.
    d.rounded_rectangle(
        [x, y + px(0.80), x + px(0.62), y + size],
        radius=px(0.10),
        fill=fg,
    )


def make_logo_mark() -> None:
    size = 512
    pad = 56
    mark = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # The two shapes are drawn apart, so the mark composites onto any
    # background without needing to know what it sits on.
    solid = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_mark(solid, (pad, pad, size - pad * 2), WHITE + (255,))
    mark.alpha_composite(solid)
    mark.save(OUT / "logo-mark.png")
    print(f"  logo-mark.png      {size}x{size}  (transparent)")


def make_icon() -> None:
    size = 1200
    icon = Image.new("RGBA", (size, size), BLUE + (255,))
    inset = int(size * 0.24)
    draw_mark(icon, (inset, inset, size - inset * 2), WHITE + (255,))

    icon.convert("RGB").save(OUT / "app-icon.png", quality=95)
    print(f"  app-icon.png       {size}x{size}")

    icon.convert("RGB").resize((48, 48), Image.LANCZOS).save(OUT / "app-icon-48.png")
    print("  app-icon-48.png    48x48   (legibility proof)")


def make_wordmark() -> None:
    w, h = 1600, 400
    mark = Image.new("RGBA", (w, h), BLUE + (255,))
    d = ImageDraw.Draw(mark)

    glyph = 150
    gap = 54
    name_font = font(IDX_DEMI, 88)
    sub_font = font(IDX_MEDIUM, 28)

    name, sub = "eu ai labels", "AI content disclosure for the EU AI Act"
    text_block = max(text_width(d, name, name_font), text_width(d, sub, sub_font))

    # Centre the whole lockup rather than pinning it left, so the asset reads as
    # composed at whatever width it is placed in.
    total = glyph + gap + text_block
    gx = (w - total) // 2
    gy = (h - glyph) // 2

    draw_mark(mark, (gx, gy, glyph), WHITE + (255,))

    tx = gx + glyph + gap
    d.text((tx, h // 2 - 62), name, font=name_font, fill=WHITE)
    d.text((tx + 3, h // 2 + 32), sub, font=sub_font, fill=MIST)

    mark.convert("RGB").save(OUT / "logo-wide.png", quality=95)
    print(f"  logo-wide.png      {w}x{h}")


# --------------------------------------------------------------------------
# The sample product shot
# --------------------------------------------------------------------------

def draw_carrot(layer: Image.Image, cx: int, top: int, length: int, girth: int, angle: float):
    """
    One tapered carrot with a leafy top, drawn upright then rotated.

    Headroom above the shoulder is sized to the leaves (they reach ~1.85x the
    girth) rather than picked arbitrarily, so `top` lands near the leaf tips and
    the composition can be positioned by eye instead of by trial.
    """
    pad_top = int(girth * 2.0)
    pad_side = girth
    body = Image.new(
        "RGBA", (girth * 2 + pad_side * 2, length + pad_top + girth), (0, 0, 0, 0)
    )
    d = ImageDraw.Draw(body)
    ox, oy = body.width // 2, pad_top

    # Taper: half-width falls off toward the tip, with a rounded shoulder.
    left, right = [], []
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        half = (girth / 2) * (1 - t) ** 0.62
        y = oy + t * length
        left.append((ox - half, y))
        right.append((ox + half, y))
    d.polygon(left + right[::-1], fill=CARROT)
    d.ellipse([ox - girth / 2, oy - girth / 2, ox + girth / 2, oy + girth / 2], fill=CARROT)

    # Highlight down one side, then a few grooves.
    hl = []
    for i in range(steps + 1):
        t = i / steps
        half = (girth / 2) * (1 - t) ** 0.62
        y = oy + t * length
        hl.append((ox - half * 0.45, y))
    hl += [(ox - (girth / 2) * (1 - t / steps) ** 0.62 * 0.1, oy + (t / steps) * length)
           for t in range(steps, -1, -1)]
    d.polygon(hl, fill=CARROT_LIGHT)

    for k in range(1, 6):
        t = k / 6
        half = (girth / 2) * (1 - t) ** 0.62
        y = oy + t * length
        d.line([(ox - half * 0.7, y), (ox + half * 0.2, y - girth * 0.10)],
               fill=CARROT_DARK, width=max(2, girth // 14))

    # Leafy top: a few blades fanning from the shoulder, alternating tone so
    # they read as separate stems rather than one mass.
    blades = [(-1.05, 1.35), (-0.62, 1.72), (-0.15, 1.85), (0.34, 1.66), (0.82, 1.28)]
    for k, (spread, reach) in enumerate(blades):
        tipx = ox + spread * girth
        tipy = oy - girth * reach
        d.polygon(
            [
                (ox - girth * 0.10, oy - girth * 0.05),
                (tipx - girth * 0.13, tipy),
                (tipx + girth * 0.13, tipy + girth * 0.16),
                (ox + girth * 0.12, oy - girth * 0.05),
            ],
            fill=LEAF if k % 2 else LEAF_DARK,
        )

    body = body.rotate(angle, resample=Image.BICUBIC, expand=True)
    layer.alpha_composite(body, (cx - body.width // 2, top))


def make_product_shot() -> Path:
    size = 900
    shot = Image.new("RGBA", (size, size), BACKDROP + (255,))

    # Soft ground shadow first, blurred so the produce sits on a surface.
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [size * 0.22, size * 0.705, size * 0.80, size * 0.795], fill=(120, 105, 88, 115)
    )
    shot.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))

    produce = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for cx, top, length, girth, angle in [
        (int(size * 0.36), 130, 330, 78, 14),
        (int(size * 0.50), 100, 370, 88, -2),
        (int(size * 0.65), 136, 315, 74, -16),
    ]:
        draw_carrot(produce, cx, top, length, girth, angle)
    shot.alpha_composite(produce)

    # A paper band across the bodies — below the shoulders, so it wraps the
    # carrots rather than slicing through the leaves.
    band_top, band_bottom = int(size * 0.46), int(size * 0.565)
    band = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(band).rounded_rectangle(
        [size * 0.255, band_top, size * 0.745, band_bottom], radius=10,
        fill=(252, 250, 246, 244),
    )
    shot.alpha_composite(band)

    d = ImageDraw.Draw(shot)
    label = font(IDX_DEMI, 30)
    caption = "FRESH CARROTS"
    d.text(
        ((size - text_width(d, caption, label)) // 2,
         band_top + (band_bottom - band_top - 34) // 2),
        caption, font=label, fill=(96, 90, 82),
    )

    path = OUT / "product-carrots.png"
    shot.convert("RGB").save(path, quality=95)
    print(f"  product-carrots.png {size}x{size}")
    return path


def paste_badge(canvas: Image.Image, badge_path: Path, height: int, xy):
    badge = Image.open(badge_path).convert("RGBA")
    width = round(badge.width * height / badge.height)
    badge = badge.resize((width, height), Image.LANCZOS)
    canvas.alpha_composite(badge, xy)
    return badge.size


def make_banner(shot_path: Path) -> None:
    w, h = 1600, 900
    banner = Image.new("RGBA", (w, h), BLUE + (255,))
    d = ImageDraw.Draw(banner)

    glyph = 92
    draw_mark(banner, (96, 92, glyph), WHITE + (255,))
    d.text((96 + glyph + 34, 108), "eu ai labels", font=font(IDX_DEMI, 52), fill=WHITE)

    d.text((96, 300), "Label AI-generated", font=font(IDX_DEMI, 86), fill=WHITE)
    d.text((96, 396), "product images.", font=font(IDX_DEMI, 86), fill=WHITE)
    d.multiline_text(
        (98, 540),
        "The official EU marks, placed where you want them,\n"
        "with a tamper-evident record of every decision.",
        font=font(IDX_MEDIUM, 32), fill=MIST, spacing=14,
    )
    d.text(
        (98, 760),
        "Independent app · not affiliated with the EU · not legal advice",
        font=font(IDX_REGULAR, 24), fill=(150, 178, 255),
    )

    # The product shot, with the label the app would place on it.
    tile = 470
    shot = Image.open(shot_path).convert("RGBA").resize((tile, tile), Image.LANCZOS)
    mask = Image.new("L", (tile, tile), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, tile, tile], radius=30, fill=255)

    tx, ty = w - tile - 110, (h - tile) // 2
    card = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
    card.paste(shot, (0, 0), mask)

    badge_h = 44
    paste_badge(card, BADGES / "eu-ai-generated-black-solid.png", badge_h,
                (26, tile - 26 - badge_h))
    banner.alpha_composite(card, (tx, ty))

    banner.convert("RGB").save(OUT / "banner.png", quality=95)
    print(f"  banner.png         {w}x{h}")


def main() -> None:
    if not BADGES.is_dir():
        sys.exit("Run scripts/prepare-badges.py first.")
    make_logo_mark()
    make_icon()
    make_wordmark()
    shot = make_product_shot()
    make_banner(shot)
    print(f"\nWrote brand assets to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
