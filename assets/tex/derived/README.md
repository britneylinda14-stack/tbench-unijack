# Derived surface-finish maps (photo-derived, by colour segmentation)

Written by `tools/derive-maps.py` from `assets/tex/*.webp`; same pixel grid as the photo textures. Status: **photo-derived**: the finishes are
inferred from each pixel's colour, not measured. A white pixel gets the matte silkscreen finish whether it is silkscreen or white plastic; a grey
pixel gets the metal finish whether it is a pad, a shield or a grey part (known case: the grey plastic housing of the J400 SO-DIMM socket on base-top
reads as metal; the reverse case: the USB-A J304 shell top is photographed dark in the flat lay and gets the matte dark finish although gallery-1.jpg shows bright steel), except where it is enclosed by a dark body (IC laser markings, highlights inside black housings: matte `marking` class). Nothing is
added that the photo does not show.

Every map has a provenance sidecar `<map>.webp.json` (generator and git commit, source texture and its sha256, every threshold and finish
value, class fractions, creation time, disclosure). The maps are deterministic: re-running with unchanged thresholds reproduces them byte for byte.

| file | channels | meaning |
|---|---|---|
| `<tex>-rm.webp` | G = roughness, B = metalness (R unused = 1) | three.js `roughnessMap` + `metalnessMap`; glTF metallicRoughness layout. Lossless WebP: the file holds the 8-bit map exactly |
| `<tex>-nrm.webp` | tangent-space normal (OpenGL +Y) | mild relief: silkscreen proud, pads and gold below the mask. Not generated for mercury-back (viewed from below, mirrored u). Lossless WebP |
| `<map>.webp.json` | JSON | provenance sidecar (see above) |
| `<tex>-albedo.webp` | sRGB colour | only written with `--delight`; not used by the viewer (see "Delight pass" below) |

## Classes and finishes

| class | rule (PIL HSV 0..255, smoothstep edges) | roughness | metalness | relief |
|---|---|---|---|---|
| mask | S [70, 110] and hue [112, 175] | 0.45 | 0.0 | +0.0 |
| silk | S below [45, 100] and V [178, 205]; plus thin tin bands (no tin left after a 2 px erosion) within 2 px of a silk pixel and 3 px of mask (anti-aliased glyph edges, no metallic halo); minus white blobs enclosed by tin (pad highlights, which become tin) | 0.78 | 0.0 | +1.0 |
| tin | S below [45, 100], V above [75, 105] and below [178, 205], not a thin band on a silk / mask boundary, not enclosed by dark; plus white blobs enclosed by tin (pad highlights) | 0.32 | 0.9 | -1.0 |
| dark | S below [45, 100] and V below [75, 105] | 0.62 | 0.0 | +0.0 |
| gold | S [55, 95], hue [4, 50], V [50, 90] | 0.3 | 0.9 | -0.6 (Mercury only; base-top and peri-top use roughness 0.4, metalness 0.5, relief -0.3: tan connector plastic is colour-identical to gold plating there, so a hedged half-metal finish) |
| marking | tin or silk weight inside a hole of the dark mask (binary_fill_holes after a 2 px closing): laser markings on IC tops, pale pixels inside black housings | 0.6 | 0.0 | +0.0 |
| other | remaining weight (ambiguous / coloured pixels) | 0.52 | 0.0 | +0.0 |

## Delight pass (measured, rejected by default)

The photos carry the photographer's lighting, so `--delight` divides the albedo by a wide masked Gaussian blur of the solder-mask luminance. Measured on these
textures the large-scale luminance of the plain mask (per-tile 20th percentile, 48 px tiles, smoothed) varies by a factor of 3 to 7 across each board, but the pattern
follows the copper: mask over pours and dense traces is lighter than mask over bare laminate (e.g. the pour on the lower left of the Mercury back). That is real
contrast, not lighting, and flattening it removed it while leaving the actual lighting (which is nearly even in these studio flat lays) alone. The viewer therefore
loads the ORIGINAL textures; the albedo files are opt-in for experiments and are not shipped.

Measured with the default blur (sigma = min(W, H) / 7) and clamp (0.86 .. 1.16): raw correction ratio ranges base-top 0.50 .. 1.34 (33 percent of mask pixels
outside the clamp), peri-top 0.62 .. 1.73 (60 percent), mercury-front 0.52 .. 2.46 (56 percent), mercury-back 0.51 .. 1.93 (52 percent). A correction that
is clamped on a third to a half of the pixels is not a lighting correction.

Maps are anti-aliased with a 0.6 px Gaussian; the relief is smoothed with 1.0 px before the gradient. Delight blur sigma = min(W, H) / 7, ratio clamped to (0.86, 1.16).

## This run

Commit `b26def303c0b351589e869fdfc79d63dfd6699e8` (clean tree for the tool and textures), 2026-10-12T03:06:49+00:00.

| texture | mask | silk | tin | dark | gold | marking | other | mean roughness | mean metalness | max normal tilt | delight ratio range (raw) | clamped px |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base-top | 0.604 | 0.085 | 0.131 | 0.117 | 0.030 | 0.017 | 0.015 | 0.484 | 0.126 | 32.8 | - | - |
| peri-top | 0.522 | 0.242 | 0.096 | 0.076 | 0.041 | 0.004 | 0.019 | 0.529 | 0.101 | 32.6 | - | - |
| mercury-front | 0.561 | 0.081 | 0.129 | 0.120 | 0.087 | 0.015 | 0.006 | 0.471 | 0.188 | 32.8 | - | - |
| mercury-back | 0.679 | 0.115 | 0.098 | 0.018 | 0.082 | 0.001 | 0.008 | 0.47 | 0.145 | - | - | - |

```json
{
 "base-top": {
  "class_fraction": {
   "mask": 0.6037,
   "silk": 0.0851,
   "tin": 0.1311,
   "dark": 0.1174,
   "gold": 0.0304,
   "marking": 0.017,
   "other": 0.0154
  },
  "roughness_mean": 0.484,
  "metalness_mean": 0.126,
  "pad_highlight_px": 26838,
  "silk_halo_px": 87569,
  "enclosed_by_dark_px": 23691,
  "normal_max_tilt_deg": 32.8
 },
 "peri-top": {
  "class_fraction": {
   "mask": 0.5225,
   "silk": 0.242,
   "tin": 0.0959,
   "dark": 0.0759,
   "gold": 0.0405,
   "marking": 0.0042,
   "other": 0.0191
  },
  "roughness_mean": 0.529,
  "metalness_mean": 0.101,
  "pad_highlight_px": 20235,
  "silk_halo_px": 129204,
  "enclosed_by_dark_px": 17460,
  "normal_max_tilt_deg": 32.6
 },
 "mercury-front": {
  "class_fraction": {
   "mask": 0.5615,
   "silk": 0.0806,
   "tin": 0.1294,
   "dark": 0.1205,
   "gold": 0.087,
   "marking": 0.0153,
   "other": 0.0058
  },
  "roughness_mean": 0.471,
  "metalness_mean": 0.188,
  "pad_highlight_px": 33841,
  "silk_halo_px": 71992,
  "enclosed_by_dark_px": 24925,
  "normal_max_tilt_deg": 32.8
 },
 "mercury-back": {
  "class_fraction": {
   "mask": 0.6793,
   "silk": 0.1148,
   "tin": 0.0976,
   "dark": 0.0178,
   "gold": 0.0818,
   "marking": 0.0011,
   "other": 0.0076
  },
  "roughness_mean": 0.47,
  "metalness_mean": 0.145,
  "pad_highlight_px": 38737,
  "silk_halo_px": 114558,
  "enclosed_by_dark_px": 2196
 }
}
```
