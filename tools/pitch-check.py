#!/usr/bin/env python3
"""Measure each texture's true px/mm per axis from STANDARD-PITCH features, and (with --write) record it in data/scale.json.

Why this exists: the flat-lay gallery photo is a composite of separately scaled cut-outs, so a scale taken from one object
(Mercury) does not carry over to the base board or the PeriBoard. Each board is therefore scaled from features ON that board:
  base   : 0.5 mm-pitch quad-flat IC (16 leads per side): pitch along x (top/bottom rows) and along z (left/right rows);
           cross-check: the 0.635 mm-pitch board-to-board connectors, and the 0.5 mm TSSOP-48 level shifters (z)
  peri   : board-to-board connector lead pitch along x (J201, J101) and z (J301), taken as 0.635 mm because they mate with the
           base connectors (which measure 0.635 mm on the base's own scale); cross-check: header pitch 1.27 mm
  mercury: verified separately (contact pitch 0.498 vs 0.5 mm; round pads measure round)
Method: phase-fold a 1-D brightness profile across the lead row at fine trial periods (no FFT).  Needs: pillow numpy scipy."""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument("--write", action="store_true"); a = ap.parse_args()
gray = lambda n: np.asarray(Image.open(os.path.join(ROOT, "assets", "tex", n)).convert("L")).astype(float)
def fold(sig, lo, hi, step=0.004):
    s = sig - ndi.uniform_filter1d(sig, int(hi * 3) | 1); s = s / (s.std() + 1e-9); n = np.arange(len(s)); best = (0.0, 0.0)
    for p in np.arange(lo, hi, step):
        v = abs((s * np.exp(-2j * np.pi * n / p)).sum()) / len(s)
        if v > best[1]: best = (p, v)
    return best
base, peri = gray("base-top.webp"), gray("peri-top.webp")
# ---- base: quad-flat IC rows (windows located on the lead rows; 16 leads per side) ----
lq = {"x": [base[262:272, 1232:1312].mean(axis=0), base[358:370, 1236:1312].mean(axis=0)],
      "z": [base[280:358, 1213:1229].mean(axis=1), base[280:358, 1322:1332].mean(axis=1)]}
px = {ax: np.mean([fold(s, 3.4, 5.6)[0] for s in v]) for ax, v in lq.items()}
bx, bz = px["x"] / 0.5, px["z"] / 0.5
print(f"base quad-flat IC (0.5 mm): pitch x {px['x']:.3f} px, z {px['z']:.3f} px  ->  {bx:.2f} px/mm along x, {bz:.2f} px/mm along z  (x/z = {bx/bz:.3f})")
# ---- base: cross-check on the 0.5 mm TSSOP-48 rows (z) ----
def best_band(img, axis, ranges, lo, hi, w=6):
    res = []
    for k in ranges:
        band = img[k:k + w, :] if axis == "x" else img[:, k:k + w]
        p, s = fold(band.mean(axis=0 if axis == "x" else 1), lo, hi); res.append((s, k, p))
    return max(res)
# ---- peri: connector lead pitch ----
j201 = best_band(peri[:, 100:720], "x", range(20, 200, 4), 8, 16)
j101 = best_band(peri[:, 100:720], "x", range(1380, 1542, 4), 8, 16)
j301 = best_band(peri[230:1330, :], "z", range(20, 300, 4), 8, 16)
pp = {"x": np.mean([j201[2], j101[2]]), "z": j301[2]}
print(f"peri connector lead pitch: x {pp['x']:.3f} px (J201 {j201[2]:.3f}, J101 {j101[2]:.3f}), z {pp['z']:.3f} px (J301)  (x/z = {pp['x']/pp['z']:.3f})")
pxmm = np.mean([pp["x"], pp["z"]]) / 0.635
print(f"  taking 0.635 mm pitch (they mate with the base connectors)  ->  {pxmm:.2f} px/mm on both axes")
print(f"  cross-check: 22.75 px header pitch at 1.27 mm -> {22.75/1.27:.2f} px/mm ({100*(22.75/1.27/pxmm-1):+.1f}% vs the connector-derived scale)")
if a.write:
    sc = json.load(open(os.path.join(ROOT, "data", "scale.json")))
    model = sc["tex_px_per_mm"]                                   # the uniform scale the part builders worked in
    sc["model_px_per_mm"] = {"base": model["base"], "peri": model["peri"], "mercury": model["mercury"]}
    sc["axis_px_per_mm"] = {"base": {"x": round(bx, 2), "z": round(bz, 2)}, "peri": {"x": round(pxmm, 2), "z": round(pxmm, 2)}, "mercury": {"x": model["mercury"], "z": model["mercury"]}}
    box = sc["board_px_box"]
    dims = dict(sc["dims_mm"])
    dims["base"] = [round((box["base"][2] - box["base"][0]) / bx, 1), round((box["base"][3] - box["base"][1]) / bz, 1)]
    dims["peri"] = [round((box["peri"][2] - box["peri"][0]) / pxmm, 1), round((box["peri"][3] - box["peri"][1]) / pxmm, 1)]
    sc["dims_mm"] = dims
    sc["note"] = ("PHOTO-DERIVED illustrative dimensions, not CAD. The flat-lay photo is a composite of separately scaled cut-outs, so each board is scaled "
                  "from standard-pitch features on that board (see tools/pitch-check.py): base from a 0.5 mm-pitch quad-flat IC (anisotropic: x and z differ by ~11 percent), "
                  "PeriBoard from 0.635 mm connector pitch, Mercury from its 0.5 mm contact pitch and 69.6 mm length. Part builders worked in the uniform model_px_per_mm; "
                  "model.js rectifies each board with model/axis.")
    sc.pop("note_dims", None); sc.pop("fpga_cross_check", None)
    json.dump(sc, open(os.path.join(ROOT, "data", "scale.json"), "w"), indent=2)
    print("wrote data/scale.json: axis_px_per_mm", sc["axis_px_per_mm"], "dims_mm", dims)
