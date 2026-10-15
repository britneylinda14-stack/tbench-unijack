#!/usr/bin/env python3
"""Photo-vs-render colour check for the UniJack viewer. Two modes:

  HERO (the acceptance criterion, CONTRACT.md "Acceptance"):
    PY tools/colorcal.py --hero qa-out/x/hero.png [--photo source-photos/gallery-1.jpg] [--band 0.90,1.10]
    The render is `node tools/qa-render.mjs --only=all --view=oblique --az=32 --el=34 --dof=1 --out=...` (1600 x 900, the Hero preset, post
    chain on, which approximates the 3/4 photograph gallery-1.jpg). Two plain solder-mask boxes in the render (A = 586,380-602,388,
    B = 556,403-574,414; scaled if the render is another size) are compared with the same two patches of plain mask in the photo
    (A = 800,790-940,835, B = 690,855-780,915, mean sRGB about 12/151/189 and 4/132/170). PASS when both ratios of linear luminance (of each box's
    mean sRGB colour) render / photo are inside the band (default 0.90..1.10). Green/blue (the teal hue) is reported, not gated. Exit code 1 on FAIL.
    Run it on the studio render; the white sweep (--env=sweep) is reported the same way, and tools/viewer-shots.mjs checks that the
    sweep's mask luminance stays within 10 percent of the studio's.

  TOP (informational, no pass band):
    PY tools/colorcal.py qa-out/x/top.png [--exposure 2.25]
    Compares a `--only=base --view=top --mode=photo` render with the flat-lay TEXTURE (assets/tex/base-top.webp) over every solder-mask
    pixel (saturated teal, the same classifier as viewer-shots). The texture is a darker exposure than gallery-1 (at the two mask spots
    it reads 0.100 and 0.100 linear where gallery-1 reads 0.258 and 0.196: 2.0 to 2.6 x), so a viewer calibrated to gallery-1 reads
    about 2.7 x the texture here. --exposure divides the ratio by that difference (default 2.25, the geometric mean of the two spot
    ratios) so the figure can be read against 1; it stays informational because the whole-mask mean and the two spots differ.
    (Before 2026-10-12 this mode carried a 0.95..1.05 target; it was dropped when the calibration moved to gallery-1.)
"""
import argparse, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERO_SIZE = (1600, 900)
HERO_BOXES = {'A': (586, 380, 602, 388), 'B': (556, 403, 574, 414)}          # plain-mask boxes in the Hero render (x0,y0,x1,y1)
PHOTO_BOXES = {'A': (800, 790, 940, 835), 'B': (690, 855, 780, 915)}         # the same two patches in gallery-1.jpg (3000 x 1688)
LUMA = np.array([.2126, .7152, .0722])


def lin(a):
    a = a / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def box_mean(img, box):
    x0, y0, x1, y1 = box
    return img[y0:y1, x0:x1].reshape(-1, 3).astype(float)


def hero(args):
    ren = np.asarray(Image.open(args.render).convert('RGB'))
    pho = np.asarray(Image.open(args.photo).convert('RGB'))
    sx, sy = ren.shape[1] / HERO_SIZE[0], ren.shape[0] / HERO_SIZE[1]
    if (sx, sy) != (1, 1): print(f'note: render is {ren.shape[1]}x{ren.shape[0]}, boxes scaled by {sx:.3f} x {sy:.3f}')
    lo, hi = args.band
    ok = True
    print(f'hero check: {os.path.relpath(args.render)} vs {os.path.relpath(args.photo)}  band {lo:.2f}..{hi:.2f} (linear luminance, render / photo)')
    for k in ('A', 'B'):
        x0, y0, x1, y1 = HERO_BOXES[k]
        rb = (int(round(x0 * sx)), int(round(y0 * sy)), int(round(x1 * sx)), int(round(y1 * sy)))
        r, p = box_mean(ren, rb), box_mean(pho, PHOTO_BOXES[k])
        mr, mp = r.mean(0), p.mean(0)
        lr, lp = lin(mr) @ LUMA, lin(mp) @ LUMA                       # luminance of the MEAN sRGB colour of each box (the README's figures are computed this way)
        ratio = lr / lp
        inband = lo <= ratio <= hi; ok &= inband
        print(f'  patch {k}: render box {rb} mean sRGB {mr.round(1)}  photo box {PHOTO_BOXES[k]} mean sRGB {mp.round(1)}  '
              f'luminance ratio {ratio:.3f}  G/B render {mr[1] / max(mr[2], 1):.3f} photo {mp[1] / max(mp[2], 1):.3f}  {"ok" if inband else "OUT OF BAND"}')
    print('PASS' if ok else 'FAIL')
    return 0 if ok else 1


def top(args):
    tex = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'tex', 'base-top.webp')).convert('RGB')).astype(float)
    ren = np.asarray(Image.open(args.render).convert('RGB').resize((tex.shape[1], tex.shape[0]))).astype(float)
    mx, mn = tex.max(axis=2), tex.min(axis=2); sat = (mx - mn) / np.maximum(mx, 1)
    mask = (sat > 0.45) & (tex[..., 2] > tex[..., 0] + 25)
    mt, mr = tex[mask].mean(axis=0), ren[mask].mean(axis=0)
    lt, lr = lin(tex[mask]).mean(axis=0), lin(ren[mask]).mean(axis=0)
    ratio = (lr @ LUMA) / (lt @ LUMA)
    print('top check (informational): render vs the flat-lay texture over all solder-mask pixels')
    print('  mask px:', int(mask.sum()))
    print('  mean sRGB  texture:', mt.round(1), ' render:', mr.round(1), ' ratio:', (mr / mt).round(3))
    print('  mean linear texture:', lt.round(4), ' render:', lr.round(4), ' ratio:', (lr / lt).round(3))
    print('  luminance ratio (linear, Rec709): %.3f   / texture-vs-gallery-1 exposure %.2f = %.3f' % (ratio, args.exposure, ratio / args.exposure))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('render')
    ap.add_argument('--hero', action='store_true', help='Hero-render check against gallery-1 patches A/B (the acceptance criterion)')
    ap.add_argument('--photo', default=os.path.join(ROOT, 'source-photos', 'gallery-1.jpg'))
    ap.add_argument('--band', default='0.90,1.10', help='pass band for the hero luminance ratios')
    ap.add_argument('--exposure', type=float, default=2.25, help='top mode: texture-vs-gallery-1 exposure difference to divide by')
    a = ap.parse_args()
    a.band = tuple(float(v) for v in a.band.split(','))
    sys.exit(hero(a) if a.hero else top(a))


if __name__ == '__main__':
    main()
