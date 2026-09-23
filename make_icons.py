#!/usr/bin/env python3
"""
Generate the Wheatburn app icons as real PNG files, with no image library.

The project has no Pillow, ImageMagick, rsvg or Inkscape available, so this
script encodes PNG by hand (zlib + struct) and rasterises the mark itself:
a clay rounded square carrying a cream "W", matching the inline SVG favicon
that already sits on every page.

The "W" is drawn as four round-capped strokes rather than from a font, and
everything is anti-aliased by supersampling. No sqrt is used anywhere — every
inside/outside test is a squared-distance comparison, which keeps 4x4
supersampling at 512px fast enough to be practical.

    python3 scripts/make_icons.py
"""

import os
import struct
import zlib

CLAY = (0xB4, 0x52, 0x1E)
CREAM = (0xFD, 0xFA, 0xF5)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )

def write_png(path, width, height, rows):
    """rows: list of bytearray, each width*4 bytes of straight RGBA."""
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0 (None)
        raw += row
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)

def inside_rounded(x, y, size, radius):
    """Is (x, y) inside a centred rounded square? Squared distance, no sqrt."""
    half = size / 2.0
    dx = abs(x - half) - (half - radius)
    dy = abs(y - half) - (half - radius)
    if dx < 0.0:
        dx = 0.0
    if dy < 0.0:
        dy = 0.0
    return dx * dx + dy * dy <= radius * radius

def w_segments(size):
    """The four strokes of the W as (x0, y0, x1, y1, half_thickness_squared)."""
    box_w = 0.50 * size
    box_h = 0.42 * size
    xl = (size - box_w) / 2.0
    yt = (size - box_h) / 2.0 + 0.005 * size
    yb = yt + box_h
    half_t = (0.088 * size) / 2.0
    h2 = half_t * half_t
    mid_y = yt + 0.34 * box_h
    return [
        (xl, yt, xl + 0.25 * box_w, yb, h2),
        (xl + 0.25 * box_w, yb, xl + 0.50 * box_w, mid_y, h2),
        (xl + 0.50 * box_w, mid_y, xl + 0.75 * box_w, yb, h2),
        (xl + 0.75 * box_w, yb, xl + box_w, yt, h2),
    ]

def on_w(x, y, segs):
    for x0, y0, x1, y1, h2 in segs:
        vx = x1 - x0
        vy = y1 - y0
        wx = x - x0
        wy = y - y0
        L2 = vx * vx + vy * vy
        if L2 <= 0.0:
            t = 0.0
        else:
            t = (wx * vx + wy * vy) / L2
            if t < 0.0:
                t = 0.0
            elif t > 1.0:
                t = 1.0
        dx = wx - t * vx
        dy = wy - t * vy
        if dx * dx + dy * dy <= h2:
            return True
    return False

def render(size, radius_ratio, ss=4):
    radius = 0.0 if radius_ratio is None else radius_ratio * size
    segs = w_segments(size)
    step = 1.0 / ss
    total = float(ss * ss)
    rows = []

    for py in range(size):
        row = bytearray()
        for px in range(size):
            covered = 0
            painted = 0
            for sy in range(ss):
                y = py + (sy + 0.5) * step
                for sx in range(ss):
                    x = px + (sx + 0.5) * step
                    if radius and not inside_rounded(x, y, size, radius):
                        continue
                    covered += 1
                    if on_w(x, y, segs):
                        painted += 1
            if covered == 0:
                row += bytes((CLAY[0], CLAY[1], CLAY[2], 0))
                continue
            f = painted / covered
            if f == 0.0:
                r, g, b = CLAY
            elif f == 1.0:
                r, g, b = CREAM
            else:
                r = int(round(CLAY[0] + (CREAM[0] - CLAY[0]) * f))
                g = int(round(CLAY[1] + (CREAM[1] - CLAY[1]) * f))
                b = int(round(CLAY[2] + (CREAM[2] - CLAY[2]) * f))
            row += bytes((r, g, b, int(round(255.0 * covered / total))))
        rows.append(row)
    return rows

def main():
    radius = 0.22

    # Apple applies its own mask, so this one is a full-bleed opaque square.
    apple = render(180, None)
    # Browser / home-screen icons keep the rounded silhouette of the favicon.
    icon192 = render(192, radius)
    icon512 = render(512, radius)

    targets = [
        ("wheatburn-shop/public/apple-touch-icon.png", 180, apple),
        ("wheatburn-site/apple-touch-icon.png", 180, apple),
        ("wheatburn-shop/public/assets/img/icon-192.png", 192, icon192),
        ("wheatburn-site/assets/img/icon-192.png", 192, icon192),
        ("wheatburn-shop/public/assets/img/icon-512.png", 512, icon512),
        ("wheatburn-site/assets/img/icon-512.png", 512, icon512),
    ]

    for rel, size, rows in targets:
        path = os.path.join(ROOT, rel)
        n = write_png(path, size, size, rows)
        print("wrote %-52s %sx%s  %s bytes" % (rel, size, size, n))

if __name__ == "__main__":
    main()