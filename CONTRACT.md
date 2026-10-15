# unijack-3d part-builder contract

An illustrative, photo-anchored 3D model of the UniJack kit (base board, Mercury module, PeriBoard), built for the
browser with three.js. It is NOT CAD. Every dimension is derived from the TBench gallery photos. Nothing here is
a measured or vendor-supplied mechanical specification.

## Honesty rules (non-negotiable)

1. Board tops show the real photo, so silkscreen and copper are real. Never add text, logos, markings or
   designators that are not legible in a photo. Never invent a part number.
2. A designator (`J303`, `J400`, ...) may be attached only if it is printed on the board and legible in a photo.
3. Heights, stack heights, plastic/metal colours, latch kinematics and PCB thickness are NOT visible in a top-down
   photo. Model them with typical values and mark them `status: 'assumed'` (see metadata below). Photo #1
   (`source-photos/gallery-1.jpg`, a 3/4 view) shows side faces: use it to judge relative heights.
4. Undersides of the base board and PeriBoard are not photographed: leave them plain. The Mercury back IS photographed.
5. Function is inferred from shape only. Write "appears to be ..." unless a marking in the photo says otherwise.
   Chip markings legible in the photos are fine to quote (they are photo-verified) but never claim what a chip does
   inside UniJack.

## Coordinate frame and units

Millimetres. Board-local axes: `+x` = right in the photo, `+z` = DOWN in the photo, `+y` = up out of the board.
Origin = centre of the board's top surface. Top surface is `y = 0`; the PCB body is `y in [-thickness, 0]`;
components are extruded upward from `y = 0`. A top-down orthographic view from +y with `up = -z` reproduces the photo.

Texture pixel to mm: `frame.x(px)`, `frame.z(py)`, `frame.len(p)`, `frame.box([x0,y0,x1,y1]) -> {cx,cz,w,d}`.

| texture (assets/tex) | size px | px per mm | frame in ctx |
|---|---|---|---|
| base-top.webp | 1452 x 698 | 8.72 (model) | `ctx.frames.base` (texture frame; true board about 160 x 87 mm after rectification) |
| peri-top.webp | 803 x 1548 | 20.0 (model) | `ctx.frames.peri` (texture frame; true board about 45 x 87 mm after rectification) |
| mercury-front.webp / mercury-back.webp | 801 x 1568 | 22.5 | `ctx.frames.mercuryFront` / `mercuryBack` (35.5 x 69.6 mm; fingers edge on the LEFT of the front texture) |

Scale (measured; see README and data/scale.json). The flat-lay photo is a composite of separately scaled cut-outs, so each board has its own scale, taken
from STANDARD-PITCH features on that board: base 8.82 px/mm along x and 7.94 along z (0.5 mm quad-flat IC pitch; its photo is stretched about 11 percent in x),
PeriBoard 17.57 px/mm on both axes (0.635 mm connector pitch), Mercury 22.53 px/mm (0.498 mm contact pitch measured). Nominal package BODY sizes are not
reliable anchors (top faces are smaller than package outlines); lead pitch is. You work in the uniform model px-space (`model_px_per_mm`: base 8.72, PeriBoard 20,
Mercury 22.53); `src/model.js` rectifies each board group at assembly by model/true scale (this equals rectifying the photo), so never correct scale inside a part file.
The textures carry a little white margin: the REAL board is the `board_px_box` inside the texture (data/scale.json); `prim.boardSlab({ box })` trims the slab to it
without moving any pixel coordinate.

## How parts are made

`ctx = { THREE, prim, mat, frames, tex, dims, scale, BOARD_T }` (see `src/lib/context.js`).

* Extruded parts whose TOP should look like the photographed part: `prim.boxPart` / `prim.cylPart` with
  `top: mat.photoTop(ctx.tex.base)` (planar UV from the photo) and a solid `side` material from `ctx.mat`.
  The same texture is shared by all parts of a board; create `photoTop` once per builder and reuse it.
* Parts on the BACK of a board (Mercury only): extrude them downward (`y0 = -thickness - h`), give them `bottom: mat.photoTop(ctx.tex.mercuryBack)` and `frame: ctx.frames.mercuryBack`; their bottom faces then get mirrored-x UVs automatically (a back photo is viewed from below).
* Repeated small things (IC leads, header pins, contacts): `prim.instanced` / `prim.gullLeads` (one draw call). `gullLeads` builds a real
  gull-wing (shoulder, knee, foot) with toe and heel solder fillets; `prim.UNIT_FOOT` (flat foot + toe fillet on its +x end) and
  `prim.UNIT_PIN` (square pin, chamfered tip) are the unit geometries for instanced tails and pins.
* Micro-geometry is ASSUMED detail (README honesty table): `prim.boxPart` bevels the edges of any free-standing box taller than 2 mm
  and at least 1.2 mm wide in both plan directions (0.2 mm; 0.3 mm above 4 mm; thin shell plates get a half-round) and the merged-box
  helpers do the same on edges that no flush or taller box of the same batch meets (`prim.freeEdges` samples each edge at its ends too,
  so a thin wall abutting the end of an edge, a T-junction, keeps that whole edge sharp rather than leaving a notch; a neighbour that
  overlaps the box does not count, its strip is hidden inside the neighbour). Lay out merged housings so T-junctions fall on SHORT edges
  (end walls full depth, long walls between them). Pass `sharp: true` for stamped steel and for pieces that abut others flush,
  `edges: { px, nx, pz, nz }` to switch single top edges off where separate `boxPart` boxes meet (no neighbour detection there),
  `bevel: c` to force a size. Solder fillets (`prim.filletTris`) stay INSIDE the photo-traced lead extent: the foot stops short by the
  fillet length and the fillet completes it to the tip (`leadGeometry`, `leadBoxes`, the PeriBoard feet); instanced feet use
  `prim.footGeometry(prim.footFrac(len))`, a unit box plus toe fillet that together span the instance length with the fillet at most
  0.3 mm (`UNIT_FOOT` is the 30 percent default). Fillets are at most 1.1 x the lead width and get 3 profile segments above 0.25 mm.
  Fillets and bevels must not change a part's bounding box where that box is used for fitting (the three mating connector pairs,
  `tools/collide.mjs`): keep them inside the old extent.
* PCB body: `prim.boardSlab` (rectangle) or `prim.shapeBoard` (outline with notches and round holes, separate front/back photo).
* Materials: `ctx.mat.*` (extend locally if needed; do not edit `src/lib/*`).
* Group each physical part (housing + leads + pins) in a `THREE.Group`, add to the parent, and describe it with `prim.meta`.

## Metadata (every physical part)

```js
prim.meta(groupOrMesh, {
  ref: 'J303',            // ONLY if printed + legible in a photo, else omit
  label: 'RJ45 jack',     // short human name
  kind: 'connector',      // board|connector|ic|passive|cap|pin|latch|led|module|other
  status: 'photo-derived',// photo-derived | photo-verified | assumed
  desc: 'Appears to be an Ethernet RJ45 jack; height assumed.',
});
```
Put `meta` on the GROUP, not on its sub-meshes. The viewer picks the nearest ancestor that has `label`.

## Budgets

Measured, not guessed. The whole assembled kit currently costs about 138k triangles, 285 meshes and **753 draw calls per frame including the shadow pass**,
measured **with the post-processing chain off**: `node tools/qa-render.mjs --only=all --post=0` prints `calls=` (oblique photo renders run the chain by default,
and its GTAO pass draws the scene a second time for normals and depth: measured 1197 calls with AO + SMAA and 1198 with the depth of field, i.e. 444 to 445 more than the plain 753, including the full-screen quads; that cost belongs to the viewer's post
chain, not to the kit, so it is outside the kit budget; the plain-render number is the one to compare). Keep the kit at or under about 800 draw calls and 150k triangles. Real cost is draw calls, not mesh count:
a multi-material mesh costs one draw call per material group, so `prim.boxPart` / `cylPart` / `boardSlab` merge face groups to one group per distinct material,
small parts (under 3 mm) do not cast shadows, and instanced leads/pins/pads are one call each. Use instancing or merged geometry for repeated parts; avoid per-part
materials (share `ctx.mat.*`). No per-part textures beyond the shared board photos. No external downloads.

## Ownership

Each builder edits ONLY its own file(s) (plus any new helper file named after its key, e.g. `src/parts/base-left-helpers.js`,
and data/tools it creates under a name starting with its key). Never edit `src/lib/*`, `src/model.js`, `src/qa.js`,
`tools/*`, or another builder's file. If you need a helper that does not exist, write it inside your own file.

## QA (do this; it is how you know you are right)

All commands run from `unijack-3d/`. The QA renderer is headless (software WebGL); one render takes a few seconds.
Use YOUR key for the output dir so parallel builders do not overwrite each other.

```
node tools/qa-render.mjs --only=base --view=top --mode=footprint --hide=base-right --dir=qa-out/KEY --out=qa-out/KEY/fp.png
PY=python3   # a Python with pillow, numpy and scipy (see README)
$PY tools/overlay.py --tex base-top --render qa-out/KEY/fp.png --out qa-out/KEY/overlay.png [--crop x0,y0,x1,y1 --zoom 2]
$PY tools/crop.py --tex base-top --box 0,0,600,350 --zoom 3 --grid 50 --out qa-out/KEY/crop.png
node tools/qa-render.mjs --only=base --view=oblique --az=35 --el=35 --out=qa-out/KEY/obl.png
```
`--only` = all|base|peri|mercury; `--view` = top|bottom|oblique|custom; `--mode` = photo|footprint|clay;
`--hide=name1,name2` hides objects by name (e.g. `base-left`, `base-right`); `--ins`/`--exp` set insertion/explode state;
`--post=0|1` plain render or the viewer's post chain (GTAO, SMAA, OutputPass; default on for oblique/custom photo renders), `--dof=1`, `--env=studio|sweep|room`.
The overlay draws the outline of every part footprint in magenta on the photo: outlines must hug the real parts.
Read the PNGs with your image viewer (Read tool) and iterate. Also check oblique and low-angle renders for floating parts,
z-fighting, parts clipping into the board or each other, and implausible proportions. Console errors are printed by the tool.

Acceptance: footprints of all large parts within about 0.5 mm of the photo outline; all parts have metadata; budgets met;
no console errors; oblique and low views look like the real hardware in `source-photos/gallery-1.jpg`.

Colour acceptance (the viewer's calibration target is the 3/4 photograph, not the flat-lay texture): the Hero render
`node tools/qa-render.mjs --only=all --view=oblique --az=32 --el=34 --dof=1 --out=qa-out/KEY/hero.png` must pass
`$PY tools/colorcal.py --hero qa-out/KEY/hero.png`, i.e. the two plain solder-mask boxes A/B of the render are within 0.90..1.10 of the
linear luminance of the same two mask patches in gallery-1.jpg (A 800,790-940,835, B 690,855-780,915). Measured on the integrated model:
A 1.008, B 0.927 (studio, 2026-10-12); the white sweep is reported the same way (0.981 / 0.903) and `tools/viewer-shots.mjs` holds its mask luminance
within 10 percent of the studio's. The old top-view check (`colorcal.py` without `--hero`, render vs the flat-lay texture) is informational
only: the texture is a 2.0 to 2.6 x darker exposure than gallery-1, so it reads about 2.7 (1.2 after the `--exposure` correction) and carries
no pass band any more.
