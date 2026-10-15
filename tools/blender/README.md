# Offline Cycles stills of the UniJack kit

`render.py` turns the exported GLB (`node tools/export-glb.mjs` -> `assets/unijack.glb`) into path-traced stills with Blender's Cycles,
using the `bpy` Python wheel (Blender 4.5 LTS; no Blender install, no GPU). Output goes to `unijack-3d/renders/` (git-ignored) and every
PNG gets a sidecar `.json` with its provenance.

The renders are for the asset library and marketing. They are **illustrative**: the geometry is the same photo-anchored, NOT-CAD model as the
browser viewer (assumed heights, stack height, PCB thickness and plastic/metal colours), the board tops are the real gallery photographs, and
everything about the light is a synthetic studio. See "What is synthetic" below.

## Run

```
python3 -m venv venv-bpy && venv-bpy/bin/pip install bpy==4.5.14 numpy      # once; ~300 MB wheel, needs glibc Linux x86_64 or macOS (venv-bpy/ is git-ignored)
node tools/export-glb.mjs                                                   # writes assets/unijack.glb (from unijack-3d/)
venv-bpy/bin/python -I tools/blender/render.py --all --match-photo          # calibrate both studios for THIS GLB, then render the six library frames (1080p)
venv-bpy/bin/python -I tools/blender/render.py --view hero --samples 192 --size 1920x1080 --out renders/hero.png   # one frame
```

Options: `--view hero|top|low|side|under|custom` (`custom` takes `--az --el --fill`; `under` and any negative elevation render without the
ground plane, since the camera is below it), `--all` (the six library frames `hero`, `low`, `top`, `side`, `under` in the dark studio and
`hero-white` in the white one, in sequence into `--out-dir`, default `renders/`; `--hero-samples`, default 192, for the dark hero frame and
`--samples`, default 128, for the rest), `--size WxH`, `--samples N` (adaptive, max per pixel),
`--studio dark|white` (dark satin stage, or a white sweep like the gallery photos' background), `--exposure` (stops; default from
`exposure.json`, see Calibration), `--exposure-file` (another store, e.g. for tests), `--allow-stale-exposure`, `--view-transform AgX|Filmic|Standard`,
`--look 'AgX - Base Contrast'|'AgX - Punchy'|None`, `--no-denoise`, `--time-limit` (seconds per frame), `--photo-rough-scale` and
`--photo-metal-f0` (material look, see below), `--match-photo` (see Calibration). `--out` defaults to `<out-dir>/<view>.png`.

Cameras use the viewer's presets: `src/main.js` `VIEWS` (hero az 32 el 34, top 0/89, low 18/11, side 90/7, under 28/-34), its
`dirFromAzEl` convention, the 32 degree vertical fov and the same bounding-box fit rule (`frameFor`, ported) for the render's aspect.
This is checked numerically, not by eye: `node tools/blender/viewer-camera.mjs --size=1920x1080 --sidecar=renders/hero.json,...` asks the
running viewer for its own camera at that aspect and diffs it against the sidecars; on the five 1080p frames of 2026-10-11 the camera position,
target and distance agree to within 0.006 mm for every preset (the residual is the sidecar's 5-decimal rounding). The glTF importer converts
the file to Z-up (Blender x = model x, y = -model z, z = model y); the kit is scaled to metres so light powers are ordinary watts.

## Timings (4 CPU cores, no GPU, OpenImageDenoise on, adaptive sampling)

Measured wall times of `bpy.ops.render.render` (`seconds` in each sidecar); the whole process adds about 3 to 5 s for import, material setup
and the sidecar. The container's speed varies by more than 3x between sessions and with what else is running on it (the same 640 x 360 /
48-sample hero frame took 11 s in one session and 38 s in the next; the 1080p low frame 153, 362, 464 and 240 s in four sessions), so take the
ranges, not single numbers. The latest column is the final GLB (sha `398d29da...`, exported from commit `7284a31`, data maps stored as PNG in
the GLB), rendered 2026-10-12 04:11-04:50 UTC while other agents shared the CPU (load average 3.6 to 4.1 during the batch): the frames came
out 0.5x to 0.9x of the previous (also shared-CPU) batch on GLB `540b994e...` and 0.8x to 1.6x of the idle-container times on the
pre-integration GLB, so none of the three columns separates the maps' cost from the contention. The hero frame was rendered twice: 450 s
alone, then 629 s with the viewer-shots test running at the same time (the 629 s frame is the one in `renders/`, re-rendered so that its
sidecar records a clean tree; the two frames measure the same mask patches to 0.1).

| frame | view | samples | pre-integration GLB `023194b7...` (2026-10-11, mostly idle) | integrated GLB `540b994e...` (2026-10-12 02:04-02:56, shared CPU) | final GLB `398d29da...` (2026-10-12 04:11-04:50, shared CPU) |
|---|---|---|---|---|---|
| 640 x 360 | hero | 48 | 11 - 38 s | not re-timed | not re-timed |
| 1280 x 720 | hero | 128 | 109 s | not re-timed | not re-timed |
| 1920 x 1080 | hero (dark) | 192 | 407 - 529 s (6.8 - 8.8 min) | 770 s (12.8 min) | 450 s alone, 629 s (10.5 min) alongside the viewer test; `renders/hero.json` |
| 1920 x 1080 | low | 128 | 153 - 362 s | 464 s (7.7 min) | 240 s (4.0 min); `renders/low.json` |
| 1920 x 1080 | top | 128 | 419 s (7.0 min) | 679 s (11.3 min) | 336 s (5.6 min); `renders/top.json` |
| 1920 x 1080 | side | 128 | 406 s (6.8 min) | 455 s (7.6 min) | 234 s (3.9 min); `renders/side.json` |
| 1920 x 1080 | under (no ground, underfill light) | 128 | 103 s (1.7 min, mostly empty frame) | 199 s (3.3 min) | 100 s (1.7 min); `renders/under.json` |
| 1920 x 1080 | hero (white studio) | 128 | 292 s (4.9 min) | 548 s (9.1 min) | 297 s (5.0 min); `renders/hero-white.json` |
| 960 x 540 | `--match-photo`, per iteration | 32 | dark 31 s, white 20 s (4 iterations each from 0 stops: about 2 min per studio) | dark 23 s, white 26 s; one iteration each (the stored exposures were already within 0.02 stops) | dark 23 s, white 23 s; one iteration each, exposures unchanged (-0.589 / -0.868), 25 s per studio including import |
| 320 x 180, six frames + both calibrations | `--all --match-photo` smoke test (8-12 samples) | | 38 s wall on the integrated GLB (code-path test, not a picture) | | not re-run |
| 3840 x 2160 | hero | 192 | **estimate, not rendered**: 4 x the 1080p time, 27 - 35 min | **estimate, not rendered**: about 50 min | **estimate, not rendered**: 30 - 45 min at this batch's speed |

Scene build (import + BVH + light tree) is under 2 s; time is almost all path tracing and scales with pixel count. Memory peak about 460 MB
(500 MB peak reported by Cycles on the integrated and final GLBs). Run long frames detached (`nohup ... &`) and poll for the sidecar; a 1080p
batch of six views is 25 - 45 minutes on an idle container, took 52 minutes (53 with both calibrations) on the shared one at 02:00 and 28
minutes (29 with both calibrations) on the shared one at 04:10. Note that `node tools/export-glb.mjs` is not byte-deterministic: two exports
from the same commit differ in the order of the 11 embedded image buffer views (the image bytes are identical as a set), so the GLB sha256 that
`exposure.json` and the sidecars pin is the sha of one particular export, not of the commit; re-export means re-calibrate (one iteration,
about 25 s per studio, when nothing else changed).

## Calibration (`--match-photo`) and what it does not achieve

Exposure is matched to the photograph, not guessed: two plain solder-mask patches on the base board (texture px 230-270 x 300-325 and
198-235 x 302-330 of `assets/tex/base-top.webp`, inside and left-below the silkscreen rectangle left of the SO-DIMM socket) are projected
through the hero camera and their mean colour is read back from a 960x540 test render; the same physical patches were measured in
`source-photos/gallery-1.jpg` (3000x1688 px boxes 800,790-940,835 and 690,855-780,915: mean sRGB 12/151/189 and 4/132/170, measured with
PIL). The view exposure is iterated until the **mean** Rec.709 luminance of the two rendered patches equals the photo's mean (within 0.02 stops);
the result and the full history are written to `exposure.json` per studio / view transform / look, **pinned to the sha256 of the GLB it was
calibrated against** (the mask albedo, the finish maps and the geometry all move it). A render whose GLB has a different sha256 is refused
unless you pass `--exposure` yourself or `--allow-stale-exposure` (the sidecar then says `exposure.stale: true`); after every re-export, run
`--match-photo` again (`--all --match-photo` does both studios first, then renders). Every render's sidecar repeats the measurement for its
own frame.

What this achieves, and what it does not, measured on the 1080p frames of 2026-10-11 (pre-integration GLB; the numbers for the integrated
GLB will be in the new sidecars):

* **Mean luminance matches, locally it does not.** The match is mean-only: render 0.231 vs photo 0.227 (+0.03 stops) for the two patches
  together, but in the photo patch A is brighter than B (0.258 vs 0.196, A is nearer the photographer's light) while in the render B is
  brighter than A (0.254 vs 0.209). The two patches are off by about 0.3 stops each in opposite directions (A -0.3, B +0.4); the studio's
  illumination gradient across that corner of the board runs the other way from the photograph's. The sidecar reports both
  (`colour_match.per_patch_stops_vs_photo`).
* **Hue and saturation do not match in either studio, and the dark studio is the nearer one.** Patch A: photo sRGB 12/151/189 (HSV hue 193,
  saturation 0.94), dark studio 43/136/168 (hue 195, sat 0.74, RGB distance 40), white studio 61/135/164 (hue 197, sat 0.63, distance 57).
  Both render the mask lighter and less saturated than the photograph; the white studio is the paler and greyer of the two, because its
  bright, even world fills the mask's specular sheen with white. (An earlier version of this file said the opposite; it was wrong, the
  numbers above are the measurement.) The red lift is the studio lights and world reflected in the glossy mask plus AgX's desaturation of
  saturated teal; the texture itself is a deep 3/92/123 there. A true match would need the photo's own light (a large neutral source with
  a white sweep) and a mask whose gloss is measured, not chosen. Treat colour in these renders as approximate, exactly as the viewer's README
  already says, and prefer the dark studio when a single library default is wanted for colour fidelity.

## What the 1080p frames look like against `gallery-1.jpg` (checked region by region, 2026-10-11 frames)

* **Highlights**: no clipping. 0 pixels at or above sRGB 254 in any of the six frames (the photograph itself is 48 % pure white, its
  cut-out background). Metal tops peaked around 224 to 244.
* **Solder mask / pads**: mean luminance matches by construction; hue is lighter and less saturated than the photo (see Calibration). Pads,
  LEDs and the silkscreen are the photo's own pixels, relit.
* **Mercury module**: the photo's Mercury is a deeper royal blue than the base board; the render keeps that relation but lifts both. The
  TriCore package, the electrolytic and the blue inductor read correctly; the SO-DIMM socket's gold contacts are visible along the edge.
* **PeriBoard pin headers**: from above (`top.png`) the 2 x 5 headers J1-J16 match the photo's layout and designators pixel for pixel
  (they are the photo). From the hero angle the gold pins stand well above their black bases; the pin length above the housing is an
  assumed height of the model (`src/parts`), not a render choice, and the viewer shows the same.
* **Shields and shells**: in those frames the RJ45 and USB-A shields rendered as polished chrome (roughness 0.28-0.36) where the photo shows
  dull, matte shields. The neutral-metal roughness floor is now 0.45 (see "Material look"), so the next batch will show them matte; this is a
  chosen look nearer the photograph, not a measured finish.
* **Board edges**: the pale rim along the boards in the `low` and `side` frames is the GLB's `fr4Edge` material (an assumed pale FR4
  colour, roughness 0.72, sRGB about 210 at its brightest in these renders). It reads brighter than the photo's edge because the key light
  grazes it; it is an assumed colour, not a measured one.
* **Shadows and ground**: soft contact shadows under the base board and the PeriBoard overhang. The dark studio ground is mostly sRGB 60-85
  (bottom-120-row medians 66-83), never black, with the fill light's reflection on the satin surface rising to about 120-160 near the bottom
  corners (hero bottom-right about 120, low about 140, side bottom-left about 158). The backdrop fades from about 10-15 at the top of the
  `low` and `side` frames to a soft horizon band of about 40-50; in `hero` the top of frame is far ground (about 46), not backdrop.

## What is synthetic (disclose this wherever a render is shown)

* **Lighting**: three area lights (warm key above-front-left, cool fill right, cool rim behind-right-high), a vertical-gradient world and a
  ground plane (dark satin with slight reflection, or a white sweep). None of it is the photographs' lighting; the photographs already
  contain their own lighting and highlights, which the renders relight (the viewer does the same). The ground is 400 kit-diagonals wide and
  fades to the world's floor colour (and to matte) with distance, and the world gradient only starts at the horizon, so low cameras see a
  soft backdrop instead of a plane edge. The `under` view (and any negative elevation) has no ground plane at all and gets a fourth,
  upward-facing area light plus a uniform world (the zenith colour everywhere), because the three studio lights only reach the undersides
  by bounce and the first attempt came out as a black silhouette. The undersides of the base board and PeriBoard are unphotographed and
  carry the model's plain assumed `maskBottom` colour, so `under.png` shows a featureless dark-teal slab with the connector bodies along
  the edges: that is all the model knows.
* **Material look** (`tune_materials`; every material's record is in the sidecar under `materials`, the parameters under `materials_tuned.look`):
  * *Photo faces* (the four `photo-*` materials): the GLB links Roughness and Metallic to the exporter's photo-derived finish map and Normal to
    its normal map (see `assets/tex/derived/README.md`; the maps are a colour segmentation of the photographs, not measurements). Those links are
    **kept**: Cycles ignores a socket's default value while it is linked, so the script never writes one there; `--photo-rough-scale f` (default 1)
    multiplies the roughness map through a clamped Math node instead, and the sidecar says `map ... (kept)` or `x f (Math node)`. What the script
    does set on these faces: Specular IOR Level 0.30 and a thin clear coat (weight 0.08, roughness 0.10), the glossy-mask look. Metal pixels of
    the photo get their base colour times `--photo-metal-f0` (default 1.5, keyed on the metalness map through a Mix node): this follows the
    viewer's **assumed** `PHOTO_METAL_F0` as first set (1.5; the viewer now uses 1.2, and the existing renders were made with 1.5: pass
    `--photo-metal-f0 1.2` to follow the viewer) (the photographed grey of a pad is its reflection of the softbox, not its reflectance; the GLB carries
    the plain photo colour). On a GLB without the maps the old fixed values apply (roughness 0.50) and the sidecar says `no map: set 0.50`.
  * *Plain metals* (three.js metalness 0.5 or more) become true conductors (metallic 1). Roughness is clamped to [floor, 0.6]: the floor is
    **0.45 for neutral steel/tin colours** (shells, shields, pads, leads; base-colour chroma below 0.15) and 0.18 for gold-coloured ones (pins,
    contacts). The 0.45 floor is a **chosen look**: gallery-1 shows dull, matte shields and the earlier 0.18 floor rendered them as chrome. It is
    not a measured finish, and it makes solder pads matter than the photo's bright reflowed solder.
  * *Plastics / dielectrics*: Specular IOR Level 0.45; those with roughness 0.5 or below (moulded connector housings) get a faint coat
    (0.15 / 0.25). Partial metalness below 0.5 is kept as exported.
  These are looks, not measured material properties.
* **Everything in the viewer's honesty table**: heights, stack height, PCB thickness, plastic/metal colours, detail geometry, undersides.
* **Camera and post**: 32 degree vertical fov perspective matching the viewer, AgX view transform, exposure calibrated as above, Open Image
  Denoise (RGB + albedo + normal passes). No depth of field, no bloom, no vignette. Nothing is painted in; no markings, text or logos
  beyond what the photographs contain.

## Sidecar `.json`

Written next to every PNG: `model.glb_sha256`, `model.model_commit` (git HEAD of the checkout), `model.dirty` plus `dirty_files` (tracked
files that differed from HEAD when the frame was rendered, so the GLB may not correspond to that commit), `model.render_py_blob` (the git blob
hash of `render.py` as run, since HEAD does not pin an edited script) and `render_py_sha256`; size, samples, denoiser, view transform, the
exposure with its source (`exposure.json` entry, the GLB it was calibrated for and whether it is stale, or the command line), every light /
world / ground parameter, the camera position, target and fov, the per-material record of what `tune_materials` did, the colour
measurements with per-patch stops, the `synthetic` sentence above, the `disclosure` paragraph read from `index.html`'s "About this model" and
the project's `status_note`. Keep the sidecar with the image when it goes into the asset library.

`exposure.json` entries carry the same pins (`glb_sha256`, `model_commit`, `render_py_blob`, `calibrated_at`) and the per-patch stops. The two
entries in the repository were last calibrated on the GLB exported at commit 7284a31 (`398d29da...`). `export-glb.mjs` is not byte-deterministic
(the embedded images come out in a different order from run to run), so a fresh export usually hashes differently and `render.py` refuses the
stored exposure until `--match-photo` is re-run (one iteration per studio, about 25 s each).

The six library frames are `hero`, `low`, `top`, `side`, `under` (dark studio) and `hero-white`. Anything in `renders/` named `test-*`,
`*-640-test`, `*-640-check` or `_match-*` is a calibration or smoke-test frame, several of them from earlier light rigs; do not use them.
