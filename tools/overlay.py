#!/usr/bin/env python3
"""Overlay a top-down footprint render on its source photo texture to check part alignment.

  python3 tools/overlay.py --tex base-top --render qa-out/base-top-footprint.png --out qa-out/base-overlay.png
  python3 tools/overlay.py ... --crop 400,0,900,350 --zoom 2      # zoom into a region (texture pixel coords)

--tex is a file in assets/tex (without .webp): base-top | peri-top | mercury-front | mercury-back.
The footprint render (qa-render --mode=footprint --view=top) draws every non-PCB part in a flat colour on black.
Output: the photo with each part's OUTLINE in magenta and a 25% colour fill. A part whose outline does not
hug the real part in the photo is misplaced or mis-sized. Needs: pillow, numpy, scipy.
"""
import argparse, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--tex", required=True); ap.add_argument("--render", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--crop"); ap.add_argument("--zoom", type=float, default=1.0)
a = ap.parse_args()

photo = Image.open(os.path.join(ROOT, "assets", "tex", a.tex + ".webp")).convert("RGB")
rend = Image.open(a.render).convert("RGB")
if rend.size != photo.size:
    print(f"note: resizing render {rend.size} -> {photo.size}", file=sys.stderr)
    rend = rend.resize(photo.size, Image.NEAREST)
P = np.asarray(photo).astype(float); R = np.asarray(rend).astype(float)
mask = R.max(axis=2) > 14
edge = mask & ~ndi.binary_erosion(mask, iterations=2)
out = P.copy()
out[mask] = P[mask] * 0.75 + R[mask] * 0.25
out[edge] = (255, 0, 255)
img = Image.fromarray(out.astype(np.uint8))
if a.crop:
    x0, y0, x1, y1 = [int(v) for v in a.crop.split(",")]
    img = img.crop((x0, y0, x1, y1))
if a.zoom != 1.0:
    img = img.resize((round(img.width * a.zoom), round(img.height * a.zoom)), Image.LANCZOS)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
img.save(a.out)
print("wrote", a.out, img.size, f"| covered {100*mask.mean():.1f}% of the board area by parts")
