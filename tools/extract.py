#!/usr/bin/env python3
"""Extract rectified, mm-scaled textures and scale data from the TBench gallery photos.

Inputs  (source-photos/, NOT committed - put Jens's originals here when available):
  gallery-2.jpg  top-down, assembled kit  (PeriBoard is stacked above the base board)
  gallery-3.jpg  flat lay: Mercury, base board, PeriBoard side by side, same plane
  gallery-4.jpg  Mercury front + back, straight-on macro
Outputs: assets/tex/*.webp, data/scale.json

Scale anchors (all PHOTO-DERIVED, not CAD):
  * Mercury length = 69.6 mm (the SO-DIMM length; the socket fixes it)            [derived]
  * Lattice iCE40HX8K-CT256 = 14 x 14 mm (Lattice datasheet) used as a cross-check [datasheet]
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source-photos"); TEX = os.path.join(ROOT, "assets", "tex"); DATA = os.path.join(ROOT, "data")
os.makedirs(TEX, exist_ok=True); os.makedirs(DATA, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None
ld = lambda n: Image.open(os.path.join(SRC, n)).convert("RGB")
g2, g3, g4 = ld("gallery-2.jpg"), ld("gallery-3.jpg"), ld("gallery-4.jpg")

MOD_LEN_MM = 69.6
# ---- bounding boxes measured by segmentation against the white background (original px) ----
F3 = dict(mod=(368, 75, 681, 682), base=(773, 32, 2225, 730), peri=(2306, 43, 2656, 718))
F4 = dict(front=(610, 60, 1406, 1623), back=(1594, 50, 2392, 1623))

s3 = (F3["mod"][3] - F3["mod"][1]) / MOD_LEN_MM          # px/mm in the flat lay
s4 = ((F4["front"][3] - F4["front"][1]) + (F4["back"][3] - F4["back"][1])) / 2 / MOD_LEN_MM
dims = lambda b, s: ((b[2] - b[0]) / s, (b[3] - b[1]) / s)
mod_wh = tuple(np.mean([dims(F3["mod"], s3), dims(F4["front"], s4), dims(F4["back"], s4)], axis=0))
base_wh = dims(F3["base"], s3); peri_wh = dims(F3["peri"], s3)
print(f"scale flat-lay {s3:.3f} px/mm, macro {s4:.3f} px/mm")
print(f"Mercury {mod_wh[0]:.1f} x {mod_wh[1]:.1f} mm | base {base_wh[0]:.1f} x {base_wh[1]:.1f} mm | PeriBoard {peri_wh[0]:.1f} x {peri_wh[1]:.1f} mm")

# ---- cross-check scale with the Lattice FPGA (datasheet 14 x 14 mm) in the flat lay ----
reg = np.asarray(g3.crop((1380, 230, 1590, 420))).astype(int)
dark = (reg.max(axis=2) < 70)
dark = ndi.binary_opening(dark, iterations=3)
lab, n = ndi.label(dark)
if n:
    big = max(range(1, n + 1), key=lambda i: (lab == i).sum()); sl = ndi.find_objects(lab)[big - 1]
    fw, fh = (sl[1].stop - sl[1].start) / s3, (sl[0].stop - sl[0].start) / s3
    print(f"FPGA dark body measured {fw:.1f} x {fh:.1f} mm (datasheet 14.0 x 14.0) -> scale error {100*((fw+fh)/2/14-1):+.1f}%")
    fpga_check = dict(measured_mm=[round(fw,2), round(fh,2)], datasheet_mm=[14, 14])
else:
    fpga_check = None

# ---- crops ----
def save(im, name, q=88):
    p = os.path.join(TEX, name); im.save(p, "WEBP", quality=q, method=6); print("wrote", name, im.size, os.path.getsize(p)//1024, "KB")
save(g3.crop(F3["base"]), "base-top.webp")
mw, mh = round(mod_wh[0] * s4), round(MOD_LEN_MM * s4)
for k in ("front", "back"):
    save(g4.crop(F4[k]).resize((mw, mh), Image.LANCZOS), f"mercury-{k}.webp")

# ---- PeriBoard: rectify the stacked top-down view (gallery-2) against the flat-lay crop (gallery-3) ----
gray = lambda im: np.asarray(im.convert("L")).astype(float)
REF_W, REF_H = 200, round(200 * peri_wh[1] / peri_wh[0])
ref = gray(g3.crop(F3["peri"]).resize((REF_W, REF_H), Image.LANCZOS)); ref = (ref - ref.mean()) / ref.std()
def warp(corners, w, h):
    (a, b, c, d) = corners   # TL TR BR BL in gallery-2 original px
    return g2.transform((w, h), Image.QUAD, (a[0], a[1], d[0], d[1], c[0], c[1], b[0], b[1]), resample=Image.BICUBIC)
def ncc(corners):
    t = gray(warp(corners, REF_W, REF_H)); t = (t - t.mean()) / (t.std() + 1e-9); return float((t * ref).mean())
# starting corners: eyeballed from the 2000 px preview x 1.5
c = [[1373*1.5, 42*1.5], [1908*1.5, 47*1.5], [1941*1.5, 1080*1.5], [1386*1.5, 1083*1.5]]
best = ncc(c); print("peri NCC start", round(best, 3))
for step in (24, 12, 6, 3, 1.5):
    improved = True
    while improved:
        improved = False
        for i in range(4):
            for j in range(2):
                for sgn in (-1, 1):
                    t = [p[:] for p in c]; t[i][j] += sgn * step; v = ncc(t)
                    if v > best + 1e-5: best, c, improved = v, t, True
print("peri NCC refined", round(best, 3), "corners", [[round(x) for x in p] for p in c])
PW, PH = round(peri_wh[0] * 20), round(peri_wh[1] * 20)
save(warp(c, PW, PH), "peri-top.webp")

json.dump(dict(
    units="mm", note="PHOTO-DERIVED illustrative dimensions; not CAD. Scale anchored on the 69.6 mm SO-DIMM length of Mercury (derived), cross-checked against the 14 mm Lattice iCE40HX8K package (datasheet).",
    px_per_mm=dict(flat_lay=round(s3, 3), macro=round(s4, 3)),
    dims_mm=dict(base=[round(base_wh[0], 1), round(base_wh[1], 1)], peri=[round(peri_wh[0], 1), round(peri_wh[1], 1)], mercury=[round(mod_wh[0], 1), MOD_LEN_MM]),
    tex_px=dict(base=list(Image.open(os.path.join(TEX, "base-top.webp")).size), peri=[PW, PH], mercury=[mw, mh]),
    tex_px_per_mm=dict(base=round(s3, 2), peri=20, mercury=round(s4, 2)),
    fpga_cross_check=fpga_check,
    peri_ncc=round(best, 3),
    source_boxes=dict(flat_lay=F3, macro=F4, peri_quad_in_gallery2=[[round(x, 1) for x in p] for p in c]),
), open(os.path.join(DATA, "scale.json"), "w"), indent=2)
print("wrote data/scale.json")
