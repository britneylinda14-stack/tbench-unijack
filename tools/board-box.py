#!/usr/bin/env python3
"""Measure where the real board lies inside each rectified texture (the crops carry a little white margin) and record it in
data/scale.json as board_px_box (texture pixels [x0,y0,x1,y1]) plus the resulting board dimensions in mm.
Does not modify the textures, so every pixel coordinate used by the part builders stays valid.  Needs: pillow numpy."""
import json, os
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, "assets", "tex"); SC = os.path.join(ROOT, "data", "scale.json")
sc = json.load(open(SC))
def blue_box(name):
    im = np.asarray(Image.open(os.path.join(T, name)).convert("RGB")).astype(float)
    mx, mn = im.max(axis=2), im.min(axis=2); sat = (mx - mn) / np.maximum(mx, 1)
    blue = (sat > 0.45) & (im[..., 2] > im[..., 0] + 25)          # solder mask; not white background, not grey shadow
    cols, rows = blue.mean(axis=0), blue.mean(axis=1)
    xs, ys = np.nonzero(cols > 0.30)[0], np.nonzero(rows > 0.62)[0]      # stricter rows: the photographed pale side-face strips at the top/bottom edges are not board top
    return [int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1]
box = {"base": blue_box("base-top.webp"), "peri": blue_box("peri-top.webp")}
ax = sc.get("axis_px_per_mm") or {k: {"x": v, "z": v} for k, v in sc["tex_px_per_mm"].items()}   # per-axis true scale (tools/pitch-check.py) when known
dims = dict(sc["dims_mm"])
for k in ("base", "peri"):
    b = box[k]; dims[k] = [round((b[2] - b[0]) / ax[k]["x"], 1), round((b[3] - b[1]) / ax[k]["z"], 1)]
sc["board_px_box"] = box; sc["dims_mm"] = dims
json.dump(sc, open(SC, "w"), indent=2)
print("board_px_box", box); print("dims_mm", dims)
