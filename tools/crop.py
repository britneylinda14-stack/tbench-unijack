#!/usr/bin/env python3
"""Crop + zoom a region of a texture and draw a labelled pixel grid in TEXTURE pixel coordinates.

  python3 tools/crop.py --tex base-top --box 0,0,600,350 --zoom 3 --grid 50 --out qa-out/mykey/crop.png

--tex : base-top | peri-top | mercury-front | mercury-back   (files in assets/tex)
--box : x0,y0,x1,y1 in texture pixels;  --grid : spacing of grid lines in texture pixels (0 = none)
Read positions straight off the labels; convert to mm with frame.x()/frame.z() in JS (mm = (px - size/2) / px_per_mm).
Needs: pillow.
"""
import argparse, os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--tex", required=True); ap.add_argument("--box", required=True); ap.add_argument("--zoom", type=float, default=2.0)
ap.add_argument("--grid", type=int, default=50); ap.add_argument("--out", required=True)
a = ap.parse_args()
im = Image.open(os.path.join(ROOT, "assets", "tex", a.tex + ".webp")).convert("RGB")
x0, y0, x1, y1 = [int(v) for v in a.box.split(",")]
x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(im.width, x1), min(im.height, y1)
z = a.zoom
c = im.crop((x0, y0, x1, y1)).resize((round((x1 - x0) * z), round((y1 - y0) * z)), Image.LANCZOS)
d = ImageDraw.Draw(c)
if a.grid > 0:
    gx = (x0 // a.grid + 1) * a.grid
    while gx < x1:
        X = (gx - x0) * z; d.line([(X, 0), (X, c.height)], fill=(255, 255, 0), width=1); d.text((X + 2, 2), str(gx), fill=(255, 255, 0)); gx += a.grid
    gy = (y0 // a.grid + 1) * a.grid
    while gy < y1:
        Y = (gy - y0) * z; d.line([(0, Y), (c.width, Y)], fill=(0, 255, 255), width=1); d.text((2, Y + 2), str(gy), fill=(0, 255, 255)); gy += a.grid
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
c.save(a.out); print("wrote", a.out, c.size, f"(texture px {x0},{y0} -> {x1},{y1})")
