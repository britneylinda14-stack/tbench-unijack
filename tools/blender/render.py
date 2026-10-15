#!/usr/bin/env python
"""Offline, path-traced stills of the UniJack kit with Blender's Cycles (the `bpy` wheel, no Blender install needed).

    python -I tools/blender/render.py --glb assets/unijack.glb --view hero --out renders/hero.png --samples 128 --size 1920x1080
    python -I tools/blender/render.py --glb assets/unijack.glb --match-photo        # calibrate exposure against gallery-1.jpg, writes exposure.json
    python -I tools/blender/render.py --all --match-photo                           # calibrate both studios, then render the six library frames

What it does
  * imports the GLB that tools/export-glb.mjs writes (named nodes, photo textures at neutral albedo, no lights), scaled to metres
  * builds a SYNTHETIC studio: three area lights (warm key above-front, cool fill, rim), a vertical-gradient world, a dark satin ground
    plane with a little reflection (`--studio white` swaps in a white sweep like the gallery photos' background)
  * cameras with the viewer's presets (src/main.js VIEWS: same az/el, the same 32 degree vertical fov and the same bounding-box fit rule,
    `frameFor`, ported from the viewer; `viewer-camera.mjs` prints the viewer's own numbers for a side-by-side check)
  * material tweaks so the GLB's PBR reads under a path tracer: photo faces get a specular level and a thin coat (their roughness,
    metalness and normal come from the GLB's photo-derived maps and are kept or scaled through nodes, never overwritten), neutral metals
    become true conductors with a matte floor, gold stays glossier. Every change is recorded per material in the sidecar.
  * Open Image Denoise, AgX view transform, exposure matched so the plain solder mask has the same MEAN luminance as gallery-1.jpg
    (exposure.json is pinned to the GLB it was calibrated for; a different GLB needs --match-photo again or an explicit --exposure)
  * a sidecar <out>.json with provenance (model commit and dirty flag, GLB sha256, render.py blob hash, every setting, timings, the colour
    measurements) and the disclosure sentence from index.html: nothing in these renders is CAD or a measured specification.

Everything about the lighting, ground, background and camera is synthetic. The board photographs are real.
"""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time

import bpy
import mathutils
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))          # unijack-3d/
DEG = math.pi / 180
MM = 0.001                                                      # the GLB is in millimetres; the scene is built in metres

# --- viewer conventions (src/main.js) -------------------------------------------------------------------------------------
VIEWS = {'hero': (32, 34, 0.9), 'top': (0, 89, 0.94), 'low': (18, 11, 0.9), 'side': (90, 7, 0.9), 'under': (28, -34, 0.9)}
FOV_V = 32.0                                                    # new THREE.PerspectiveCamera(32, ...): vertical fov in degrees
BOARDS = ('base', 'peri', 'mercury')
# the six library frames rendered by --all: (view, studio, output name)
LIBRARY = [('hero', 'dark', 'hero'), ('low', 'dark', 'low'), ('top', 'dark', 'top'), ('side', 'dark', 'side'), ('under', 'dark', 'under'),
           ('hero', 'white', 'hero-white')]

# plain solder-mask patches used for the exposure match (texture px of assets/tex/base-top.webp -> base-board mm -> world; see README)
# Photo side: the same physical patches in source-photos/gallery-1.jpg (3000x1688), inside / left-below the silkscreen rectangle left of the SO-DIMM socket.
TEX_PX_PER_MM, TEX_W, TEX_H = 8.72, 1452, 698
BASE_SCALE = (0.9886621315192744, 1.0982367758186398)           # base group rectification x, z (export log; stored in the GLB node)
PATCHES = {
    'A': {'tex': (230, 300, 270, 325), 'photo': (800, 790, 940, 835)},
    'B': {'tex': (198, 302, 235, 330), 'photo': (690, 855, 780, 915)},
}
PHOTO_MEANS_SRGB = {'A': (12.2, 150.8, 188.8), 'B': (4.3, 132.4, 170.2)}   # measured with PIL (mean RGB of the photo patches, 0..255)

# material look (render choices, disclosed in the sidecar and README)
PHOTO_SPECULAR = 0.30          # Specular IOR Level of the photo faces
PHOTO_COAT = (0.08, 0.10)      # (Coat Weight, Coat Roughness) of the photo faces: a thin clear coat on the glossy mask
METAL_FLOOR_NEUTRAL = 0.45     # roughness floor for neutral (steel / tin) conductors: shells, shields, pads, leads. Chosen look: gallery-1 shows dull, matte shields
METAL_FLOOR_GOLD = 0.18        # roughness floor for gold-coloured conductors (pins, contacts): plating stays glossier
METAL_CEIL = 0.6
NEUTRAL_CHROMA = 0.15          # max-min of the linear base colour below this = neutral metal

DISCLOSURE_FALLBACK = ('Illustrative model built from TBench gallery photographs, not CAD. Part heights, plastic and metal colours, the '
                       'PeriBoard stack height, PCB thickness and detail geometry are assumed.')


def log(*a):
    print('[render]', *a, flush=True)


def dir_from_az_el(az, el):
    """Viewer convention (glTF frame: +y up, +z towards the viewer at az=0) converted to Blender's frame (Z up, Y = -glTF z)."""
    a, e = az * DEG, el * DEG
    gx, gy, gz = math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a)
    return mathutils.Vector((gx, -gz, gy))


def board_points(objs_by_board):
    """8 corners of the world bounding box of each board group (the viewer's boardPoints)."""
    pts = []
    for name, objs in objs_by_board.items():
        lo = mathutils.Vector((1e9, 1e9, 1e9)); hi = mathutils.Vector((-1e9, -1e9, -1e9))
        for o in objs:
            for c in o.bound_box:
                w = o.matrix_world @ mathutils.Vector(c)
                for i in range(3): lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
        for i in range(8):
            pts.append(mathutils.Vector((hi.x if i & 1 else lo.x, hi.y if i & 2 else lo.y, hi.z if i & 4 else lo.z)))
    return pts


def frame_for(pts, direction, fill, aspect, fov_v=FOV_V):
    """Port of src/main.js frameFor: smallest distance at which every point projects inside +-fill of the canvas, camera axis fixed."""
    lo = mathutils.Vector((1e9,) * 3); hi = mathutils.Vector((-1e9,) * 3)
    for p in pts:
        for i in range(3): lo[i] = min(lo[i], p[i]); hi[i] = max(hi[i], p[i])
    c = (lo + hi) / 2
    back = direction.normalized()
    up = mathutils.Vector((0, 0, 1))
    right = up.cross(back)
    if right.length_squared < 1e-8: right = mathutils.Vector((1, 0, 0))
    right.normalize(); cam_up = back.cross(right)
    tan_v = math.tan(fov_v * DEG / 2); kx = fill * tan_v * aspect; ky = fill * tan_v
    X, Y, Z = [], [], []; z_max = -1e9
    for p in pts:
        v = p - c; X.append(v.dot(right)); Y.append(v.dot(cam_up)); z = v.dot(back); Z.append(z); z_max = max(z_max, z)

    def span(d):
        x0, x1, y0, y1 = -1e9, 1e9, -1e9, 1e9
        for i in range(len(X)):
            w = d - Z[i]
            x0 = max(x0, X[i] - kx * w); x1 = min(x1, X[i] + kx * w); y0 = max(y0, Y[i] - ky * w); y1 = min(y1, Y[i] + ky * w)
        return x0, x1, y0, y1, (x0 <= x1 and y0 <= y1)

    lo_d, hi_d = z_max + 1 * MM, max(6000 * MM, z_max + 6000 * MM)
    for _ in range(50):
        mid = (lo_d + hi_d) / 2
        if span(mid)[4]: hi_d = mid
        else: lo_d = mid
    d = hi_d; x0, x1, y0, y1, _ = span(d)
    tgt = c + right * ((x0 + x1) / 2) + cam_up * ((y0 + y1) / 2)
    return {'target': tgt, 'pos': tgt + back * d, 'dist': d, 'right': right, 'up': cam_up, 'back': back}


# --- scene construction ---------------------------------------------------------------------------------------------------
def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0
    return sc


def import_glb(path):
    t = time.time()
    bpy.ops.import_scene.gltf(filepath=path)
    root = next((o for o in bpy.data.objects if o.parent is None and o.name.startswith('UniJack')), None)
    if root is None: raise SystemExit('GLB root node "UniJack-kit" not found')
    root.scale = (MM, MM, MM)                                   # mm -> m; the per-board rectification scales inside stay as stored
    bpy.context.view_layer.update()
    by_board = {}
    for b in BOARDS:
        top = bpy.data.objects.get(b)
        if top is None: raise SystemExit(f'board node "{b}" not found in the GLB')
        by_board[b] = [o for o in top.children_recursive if o.type == 'MESH'] + ([top] if top.type == 'MESH' else [])
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    log(f'imported {path} in {time.time() - t:.1f}s: {len(bpy.data.objects)} objects, {len(meshes)} meshes, {len(bpy.data.materials)} materials')
    return root, by_board


def _link_source(sock):
    """'<node type>[<output>]' of what feeds a linked socket, for the sidecar."""
    l = sock.links[0]
    return f'{l.from_node.type.lower()}[{l.from_socket.name}]'


def scale_linked(nt, bsdf, name, factor):
    """A texture-linked scalar socket cannot be overwritten (Cycles ignores default_value while a link exists): put a clamped
    multiply node between the texture and the socket instead. factor 1 leaves the graph alone. Returns the sidecar description."""
    sock = bsdf.inputs[name]
    src_desc = 'map ' + _link_source(sock)
    if abs(factor - 1.0) < 1e-6: return src_desc + ' (kept)'
    link = sock.links[0]; from_sock = link.from_socket
    nt.links.remove(link)
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.use_clamp = True; mul.label = f'{name} x {factor:g}'
    mul.inputs[1].default_value = factor
    nt.links.new(from_sock, mul.inputs[0]); nt.links.new(mul.outputs[0], sock)
    return f'{src_desc} x {factor:g} (Math node, clamped)'


def metal_f0_gain(nt, bsdf, gain):
    """Mirror the viewer's PHOTO_METAL_F0: on the photo faces a metal pixel's colour is its specular colour, and the GLB carries the
    plain photographed grey (the pad's reflection of the photographer's softbox, not its reflectance). Blend Base Color towards
    colour x gain where the metalness map says metal; dielectric pixels are unchanged. ASSUMED, as in the viewer's README row.
    The default gain 1.5 is the viewer's EARLIER value (src/lib/materials.js PHOTO_METAL_F0 has been 1.2 since the integration: 1.5
    over-brightened the pads there). The renders made so far used 1.5; pass --photo-metal-f0 1.2 to follow the viewer. The gain touches
    metal pixels only, so the exposure calibration (measured on plain solder mask) does not depend on it."""
    base = bsdf.inputs['Base Color']; met = bsdf.inputs['Metallic']
    if abs(gain - 1.0) < 1e-6 or not base.links or not met.links: return None
    tex_out = base.links[0].from_socket; met_out = met.links[0].from_socket
    nt.links.remove(base.links[0])
    sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'; sc.inputs['Scale'].default_value = gain; sc.label = f'metal F0 x {gain:g}'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.clamp_result = False; mix.label = 'metal pixels only'
    nt.links.new(tex_out, sc.inputs[0]); nt.links.new(tex_out, mix.inputs['A']); nt.links.new(sc.outputs[0], mix.inputs['B'])
    nt.links.new(met_out, mix.inputs['Factor']); nt.links.new(mix.outputs['Result'], base)
    return f'photo colour x {gain:g} where the metalness map is 1 (Mix node keyed on the Metallic source), unchanged where 0'


def tune_materials(photo_rough_scale=1.0, photo_metal_f0=1.5):
    """Make the GLB's PBR read under a path tracer. Texture-linked sockets (the photo faces' roughness / metalness / normal come from the
    exporter's photo-derived maps) are kept or scaled through nodes, never overwritten. Returns {summary counts, per-material record}."""
    summary = {'photo_faces': 0, 'metals_neutral': 0, 'metals_gold': 0, 'plastics': 0, 'untouched': 0}
    per_material = {}
    for m in bpy.data.materials:
        if not m.use_nodes or m.node_tree is None: summary['untouched'] += 1; per_material[m.name] = {'class': 'untouched', 'note': 'no node tree'}; continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None: summary['untouched'] += 1; per_material[m.name] = {'class': 'untouched', 'note': 'no Principled BSDF'}; continue
        rough_s, metal_s, normal_s = bsdf.inputs['Roughness'], bsdf.inputs['Metallic'], bsdf.inputs['Normal']
        textured = bool(bsdf.inputs['Base Color'].links)
        rec = {}
        if textured:
            # solder mask and photographed part tops: the photo is the albedo (neutral factor from the exporter). Roughness / metalness /
            # normal: the GLB's photo-derived maps when present (kept or scaled), else fixed values for a glossy mask.
            rec['class'] = 'photo face'
            rec['roughness'] = scale_linked(nt, bsdf, 'Roughness', photo_rough_scale) if rough_s.links else None
            if not rough_s.links: rough_s.default_value = 0.50; rec['roughness'] = 'no map: set 0.50'
            if metal_s.links:
                rec['metallic'] = 'map ' + _link_source(metal_s) + ' (kept)'
                f0 = metal_f0_gain(nt, bsdf, photo_metal_f0)
                if f0: rec['base_color'] = f0
            else:
                rec['metallic'] = f'no map: kept {metal_s.default_value:.2f}'
            rec['normal'] = ('map ' + _link_source(normal_s) + ' (kept)') if normal_s.links else 'none'
            bsdf.inputs['Specular IOR Level'].default_value = PHOTO_SPECULAR
            bsdf.inputs['Coat Weight'].default_value = PHOTO_COAT[0]; bsdf.inputs['Coat Roughness'].default_value = PHOTO_COAT[1]
            bsdf.inputs['Coat IOR'].default_value = 1.5
            rec['specular_ior_level'] = PHOTO_SPECULAR; rec['coat'] = {'weight': PHOTO_COAT[0], 'roughness': PHOTO_COAT[1], 'ior': 1.5}
            for n in nt.nodes:
                if n.type == 'TEX_IMAGE': n.interpolation = 'Cubic'
            rec['texture_interpolation'] = 'Cubic'
            summary['photo_faces'] += 1
        elif metal_s.links or rough_s.links:
            # an untextured material with a linked scalar socket: nothing in the current exporter does this; leave it and say so
            rec = {'class': 'untouched', 'note': 'linked Roughness/Metallic on a plain material: left as exported'}
            summary['untouched'] += 1
        elif metal_s.default_value >= 0.5:
            col = bsdf.inputs['Base Color'].default_value[:3]; chroma = max(col) - min(col)
            gold = chroma >= NEUTRAL_CHROMA
            floor = METAL_FLOOR_GOLD if gold else METAL_FLOOR_NEUTRAL
            r0 = rough_s.default_value; r1 = min(METAL_CEIL, max(floor, r0)); m0 = metal_s.default_value
            metal_s.default_value = 1.0                      # three.js partial metalness is a look, not a material; Cycles wants a real conductor
            rough_s.default_value = r1
            rec = {'class': 'gold conductor (pins, contacts)' if gold else 'neutral conductor (shells, shields, pads, leads)',
                   'metallic': f'{m0:.2f} -> 1.00 (forced conductor)',
                   'roughness': f'{r0:.2f} -> {r1:.2f}' + (' (floor)' if r1 > r0 + 1e-6 else ' (kept)'),
                   'base_color_linear': [round(c, 3) for c in col], 'chroma': round(chroma, 3)}
            summary['metals_gold' if gold else 'metals_neutral'] += 1
        else:
            bsdf.inputs['Specular IOR Level'].default_value = 0.45
            rec = {'class': 'plastic / dielectric' + (f' (partial metalness {metal_s.default_value:.2f} kept)' if metal_s.default_value > 0 else ''),
                   'specular_ior_level': 0.45, 'roughness': f'{rough_s.default_value:.2f} (kept)'}
            if rough_s.default_value <= 0.5:                   # glossier moulded plastics (connector housings): a faint coat
                bsdf.inputs['Coat Weight'].default_value = 0.15; bsdf.inputs['Coat Roughness'].default_value = 0.25
                rec['coat'] = {'weight': 0.15, 'roughness': 0.25}
            summary['plastics'] += 1
        per_material[m.name] = rec
    summary['look'] = {'photo_specular_ior_level': PHOTO_SPECULAR, 'photo_coat': {'weight': PHOTO_COAT[0], 'roughness': PHOTO_COAT[1]},
                       'photo_roughness_scale': photo_rough_scale, 'photo_metal_f0_gain': photo_metal_f0,
                       'metal_roughness_floor_neutral': METAL_FLOOR_NEUTRAL, 'metal_roughness_floor_gold': METAL_FLOOR_GOLD, 'metal_roughness_ceiling': METAL_CEIL,
                       'note': 'render choices, not measured material properties; the neutral-metal floor is a chosen matte look (gallery-1 shows dull shields), '
                               'the metal F0 gain mirrors the viewer\'s ASSUMED PHOTO_METAL_F0 (1.5 by default, the viewer\'s earlier value; the viewer uses 1.2 now)'}
    return {'summary': summary, 'per_material': per_material}


def add_area(name, loc, target, size, power, color, shape='SQUARE', size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.shape = shape; data.size = size
    if size_y: data.size_y = size_y
    data.energy = power; data.color = color
    o = bpy.data.objects.new(name, data); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (mathutils.Vector(target) - mathutils.Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def build_studio(centre, extent, studio, ground=True):
    """Synthetic three-light studio around the kit. `extent` is the kit's xy diagonal in metres. `ground=False` leaves the
    ground plane out (cameras below the board, i.e. the `under` view, would otherwise look at its back face)."""
    sc = bpy.context.scene
    r = extent
    lights = []
    if studio == 'white':
        key = add_area('key', centre + mathutils.Vector((-0.9 * r, -1.1 * r, 1.9 * r)), centre, 1.6 * r, 5.0 * r * r / 0.03, (1.0, 0.96, 0.90))
        fill = add_area('fill', centre + mathutils.Vector((1.9 * r, -0.6 * r, 1.5 * r)), centre, 1.3 * r, 1.6 * r * r / 0.03, (0.90, 0.95, 1.0))
        rim = add_area('rim', centre + mathutils.Vector((0.9 * r, 1.4 * r, 1.6 * r)), centre, 0.9 * r, 1.6 * r * r / 0.03, (0.95, 0.98, 1.0))
    else:
        key = add_area('key', centre + mathutils.Vector((-0.9 * r, -1.1 * r, 1.9 * r)), centre, 1.6 * r, 6.0 * r * r / 0.03, (1.0, 0.97, 0.93))
        fill = add_area('fill', centre + mathutils.Vector((1.9 * r, -0.6 * r, 1.5 * r)), centre, 1.3 * r, 1.5 * r * r / 0.03, (0.88, 0.93, 1.0))
        rim = add_area('rim', centre + mathutils.Vector((0.9 * r, 1.4 * r, 1.6 * r)), centre, 0.9 * r, 1.6 * r * r / 0.03, (0.85, 0.93, 1.0))
    rig = [key, fill, rim]
    if not ground:
        # camera below the board: the three studio lights only reach the undersides by bounce, so add a soft neutral fill from below
        under = add_area('underfill', centre + mathutils.Vector((0.4 * r, -0.9 * r, -1.5 * r)), centre, 2.0 * r, 3.0 * r * r / 0.03, (0.95, 0.96, 1.0))
        rig.append(under)
    for o in rig:
        lights.append({'name': o.name, 'type': 'area', 'location_m': [round(v, 4) for v in o.location], 'size_m': round(o.data.size, 4),
                       'power_W': round(o.data.energy, 2), 'color': [round(c, 3) for c in o.data.color]})

    # world: a vertical gradient (dark floor, lighter zenith) so reflections on the mask and metals have something to show
    world = bpy.data.worlds.new('studio'); sc.world = world; world.use_nodes = True
    nt = world.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); mr = nt.nodes.new('ShaderNodeMapRange'); ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    mr.inputs['From Min'].default_value = -1; mr.inputs['From Max'].default_value = 1
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs[0], out.inputs[0])
    ramp.color_ramp.elements.new(0.5)                          # [0, 0.5] = below and at the horizon: floor colour; the gradient rises from the horizon to the zenith
    if studio == 'white':
        ramp.color_ramp.elements[0].color = (0.75, 0.76, 0.78, 1); ramp.color_ramp.elements[1].color = (0.75, 0.76, 0.78, 1); ramp.color_ramp.elements[2].color = (1.0, 1.0, 1.0, 1)
        bg.inputs['Strength'].default_value = 0.9
        world_desc = {'type': 'vertical gradient', 'bottom': [0.75, 0.76, 0.78], 'top': [1, 1, 1], 'strength': 0.9}
    else:
        ramp.color_ramp.elements[0].color = (0.008, 0.010, 0.014, 1); ramp.color_ramp.elements[1].color = (0.008, 0.010, 0.014, 1); ramp.color_ramp.elements[2].color = (0.08, 0.10, 0.13, 1)
        bg.inputs['Strength'].default_value = 0.5
        world_desc = {'type': 'vertical gradient', 'bottom': [0.008, 0.010, 0.014], 'top': [0.08, 0.10, 0.13], 'strength': 0.5}

    if not ground:
        # no floor to hide: lift the lower hemisphere to the zenith colour so the undersides are not silhouetted against black
        top = ramp.color_ramp.elements[2].color
        ramp.color_ramp.elements[0].color = top; ramp.color_ramp.elements[1].color = top
        world_desc = {**world_desc, 'bottom': [round(c, 3) for c in top[:3]], 'note': 'uniform (zenith colour everywhere) for the under view'}
        return {'lights': lights, 'world': world_desc, 'ground': {'note': 'no ground plane: the camera is below the board (under view), so the kit floats in the world (synthetic); an extra upward-facing area light (underfill) lights the undersides'}}
    # ground: a satin plane just under the base board (the viewer's shadow catcher sits at y = -1.75 mm)
    mesh = bpy.data.meshes.new('ground'); s = 400 * r
    mesh.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)]); mesh.update()
    ground = bpy.data.objects.new('ground', mesh); sc.collection.objects.link(ground)
    ground.location = (centre.x, centre.y, -1.75 * MM)
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True
    gb = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    if studio == 'white':
        gb.inputs['Base Color'].default_value = (0.82, 0.82, 0.83, 1); gb.inputs['Roughness'].default_value = 0.55
        gb.inputs['Specular IOR Level'].default_value = 0.3
        ground_desc = {'color': [0.82, 0.82, 0.83], 'roughness': 0.55, 'note': 'white sweep like the gallery background (synthetic)'}
    else:
        gb.inputs['Base Color'].default_value = (0.014, 0.016, 0.020, 1); gb.inputs['Roughness'].default_value = 0.45
        gb.inputs['Specular IOR Level'].default_value = 0.35; gb.inputs['Coat Weight'].default_value = 0.08; gb.inputs['Coat Roughness'].default_value = 0.3
        ground_desc = {'color': [0.014, 0.016, 0.020], 'roughness': 0.45, 'coat': 0.08, 'note': 'dark satin with slight reflection (synthetic)'}
    # distance fade: beyond a few kit-diagonals the ground takes the world's floor colour and goes matte, so a low camera sees no plane edge or horizon line
    gnt = gm.node_tree; tcn = gnt.nodes.new('ShaderNodeTexCoord'); ln = gnt.nodes.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    fade = gnt.nodes.new('ShaderNodeMapRange'); fade.inputs['From Min'].default_value = 3 * r; fade.inputs['From Max'].default_value = 12 * r
    mix = gnt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs['A'].default_value = gb.inputs['Base Color'].default_value
    e0 = ramp.color_ramp.elements[0].color; mix.inputs['B'].default_value = (e0[0], e0[1], e0[2], 1)
    gnt.links.new(tcn.outputs['Object'], ln.inputs[0]); gnt.links.new(ln.outputs['Value'], fade.inputs['Value']); gnt.links.new(fade.outputs['Result'], mix.inputs['Factor'])
    gnt.links.new(mix.outputs['Result'], gb.inputs['Base Color'])
    rough = gnt.nodes.new('ShaderNodeMapRange'); rough.inputs['From Min'].default_value = 3 * r; rough.inputs['From Max'].default_value = 12 * r
    rough.inputs['To Min'].default_value = gb.inputs['Roughness'].default_value; rough.inputs['To Max'].default_value = 0.9
    gnt.links.new(ln.outputs['Value'], rough.inputs['Value']); gnt.links.new(rough.outputs['Result'], gb.inputs['Roughness'])
    ground_desc['fade'] = 'base colour and roughness blend to the world floor colour / matte between 3 and 12 kit diagonals from the centre'
    ground.data.materials.append(gm)
    return {'lights': lights, 'world': world_desc, 'ground': ground_desc}


def make_camera(frame, aspect):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam'); cd.sensor_fit = 'VERTICAL'; cd.angle_y = FOV_V * DEG
    cd.clip_start = 1 * MM; cd.clip_end = 20.0
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    rot = mathutils.Matrix((frame['right'], frame['up'], frame['back'])).transposed()   # columns = camera local X, Y, Z (looks along -Z)
    cam.matrix_world = mathutils.Matrix.Translation(frame['pos']) @ rot.to_4x4()
    return cam


def setup_render(sc, w, h, samples, exposure, view_transform, denoise, time_limit, look='None'):
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'; cy.samples = samples; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01
    cy.time_limit = time_limit
    cy.max_bounces = 8; cy.diffuse_bounces = 4; cy.glossy_bounces = 6; cy.transmission_bounces = 4; cy.transparent_max_bounces = 8
    cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 0.5
    cy.use_denoising = bool(denoise)
    if denoise:
        try:
            cy.denoiser = 'OPENIMAGEDENOISE'; cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; cy.denoising_prefilter = 'ACCURATE'
        except TypeError as e:
            log('OpenImageDenoise not available in this build:', e); cy.use_denoising = False
    sc.render.resolution_x = w; sc.render.resolution_y = h; sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.color_depth = '8'
    sc.render.image_settings.compression = 30
    sc.display_settings.display_device = 'sRGB'
    sc.view_settings.view_transform = view_transform
    try: sc.view_settings.look = look
    except TypeError: log('look not available:', look); sc.view_settings.look = 'None'
    sc.view_settings.exposure = exposure; sc.view_settings.gamma = 1.0
    sc.render.use_persistent_data = True


# --- measurement ------------------------------------------------------------------------------------------------------------
def patch_world_rect(tex_box):
    """Texture px box on base-top.webp -> world xy rectangle (metres) on the base board's top surface (z = 0)."""
    x0, y0, x1, y1 = tex_box
    def X(px): return (px - TEX_W / 2) / TEX_PX_PER_MM * BASE_SCALE[0] * MM
    def Yb(py): return -((py - TEX_H / 2) / TEX_PX_PER_MM * BASE_SCALE[1]) * MM   # Blender Y = -glTF z; glTF z = down in the photo
    return (X(x0), Yb(y1), X(x1), Yb(y0))                                            # (xmin, ymin, xmax, ymax)


def read_png(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.empty(w * h * img.channels, np.float32); img.pixels.foreach_get(arr)
    arr = arr.reshape(h, w, img.channels)[::-1, :, :3]                                # rows are stored bottom-up; stored 8-bit sRGB -> 0..1
    bpy.data.images.remove(img)
    return arr


def measure_patches(sc, cam, png_path):
    arr = read_png(png_path); h, w = arr.shape[:2]
    out = {}
    for k, p in PATCHES.items():
        xmin, ymin, xmax, ymax = patch_world_rect(p['tex'])
        pts = [world_to_camera_view(sc, cam, mathutils.Vector((x, y, 0.0))) for x in (xmin, xmax) for y in (ymin, ymax)]
        px = [(v.x * w, (1 - v.y) * h) for v in pts]
        if any(v.z <= 0 for v in pts) or any(not (0 <= x < w and 0 <= y < h) for x, y in px): out[k] = None; continue
        xs = sorted(x for x, _ in px); ys = sorted(y for _, y in px)
        # inner box of the projected quad (shrunk) so the sample stays on plain mask
        bx0, bx1 = xs[1] + 0.15 * (xs[2] - xs[1]), xs[2] - 0.15 * (xs[2] - xs[1]); by0, by1 = ys[1] + 0.15 * (ys[2] - ys[1]), ys[2] - 0.15 * (ys[2] - ys[1])
        X0, X1, Y0, Y1 = int(bx0), max(int(bx0) + 1, int(math.ceil(bx1))), int(by0), max(int(by0) + 1, int(math.ceil(by1)))
        region = arr[Y0:Y1, X0:X1].reshape(-1, 3)
        out[k] = {'pixel_box': [X0, Y0, X1, Y1], 'n': int(region.shape[0]), 'mean_sRGB': [round(float(v) * 255, 1) for v in region.mean(0)]}
    return out


def srgb_to_lum(rgb255):
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def per_patch_stops(meas):
    """Per-patch render-vs-photo luminance difference in stops (the exposure match equalises only the MEAN of the patches)."""
    out = {}
    for k, m in meas.items():
        if m: out[k] = round(math.log2(max(srgb_to_lum(m['mean_sRGB']), 1e-6) / srgb_to_lum(PHOTO_MEANS_SRGB[k])), 3)
        else: out[k] = None
    return out


def disclosure_from_index():
    try:
        html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
        m = re.search(r'<div class="about-body">\s*<p>(.*?)</p>', html, re.S)
        short = re.search(r'<p class="short">(.*?)</p>', html, re.S)
        parts = [re.sub(r'<[^>]+>', '', x.group(1)).strip() for x in (short, m) if x]
        return ' '.join(parts) if parts else DISCLOSURE_FALLBACK
    except OSError:
        return DISCLOSURE_FALLBACK


def _git(*a):
    try:
        r = subprocess.run(['git', '-C', ROOT, *a], capture_output=True, text=True, timeout=10)
        return r.stdout.rstrip('\n') if r.returncode == 0 else None        # rstrip only: porcelain lines start with a status column that may be a space
    except Exception:
        return None


def git_info():
    """HEAD, whether tracked files differ from it (the GLB may then not match the commit), and the blob hash of render.py as run
    (HEAD does not pin the script when it has uncommitted edits)."""
    head = (_git('rev-parse', 'HEAD') or '').strip() or None
    status = _git('status', '--porcelain', '--untracked-files=no')
    dirty_files = [l[3:] for l in status.splitlines() if len(l) > 3] if status is not None else None
    blob = (_git('hash-object', os.path.join(HERE, 'render.py')) or '').strip() or None
    return {'model_commit': head, 'dirty': (bool(dirty_files) if dirty_files is not None else None),
            'dirty_files': (dirty_files[:40] if dirty_files else []), 'render_py_blob': blob,
            'render_py_sha256': sha256(os.path.join(HERE, 'render.py'))}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


# --- exposure store -----------------------------------------------------------------------------------------------------------
def load_exposures(path):
    if not os.path.exists(path): return {}
    try: return json.load(open(path))
    except (OSError, ValueError): return {}


def resolve_exposure(args, stored, key, glb_sha, exposure_file):
    """The stored exposure is only valid for the GLB it was calibrated against (the mask's albedo, the maps and the geometry all move
    it). Returns (exposure, source record). Refuses a stale entry unless --exposure or --allow-stale-exposure is given."""
    if args.exposure is not None:
        return args.exposure, {'source': 'command line (--exposure)', 'exposure_stops': round(args.exposure, 3)}
    entry = stored.get(key)
    if not entry:
        log(f'WARNING: no exposure for "{key}" in {exposure_file}; rendering at 0 stops. Run --match-photo first.')
        return 0.0, {'source': f'none ({key} not in exposure.json), 0 stops', 'exposure_stops': 0.0}
    cal_sha = entry.get('glb_sha256')
    rec = {'source': f'exposure.json [{key}]', 'exposure_stops': entry['exposure'], 'calibrated_for_glb_sha256': cal_sha,
           'calibrated_for_model_commit': entry.get('model_commit'), 'calibrated_at': entry.get('calibrated_at')}
    if cal_sha is None:
        log(f'WARNING: exposure.json [{key}] is not pinned to a GLB (no glb_sha256); re-run --match-photo to pin it')
        rec['stale'] = 'unknown (entry not pinned)'
    elif cal_sha != glb_sha:
        msg = (f'exposure.json [{key}] was calibrated for GLB sha256 {cal_sha[:12]}..., but the GLB being rendered is {glb_sha[:12]}... '
               f'The stored exposure {entry["exposure"]:+.3f} is not valid for it.')
        if not args.allow_stale_exposure:
            raise SystemExit('[render] REFUSED: ' + msg + ' Run --match-photo (per studio) to recalibrate, pass --exposure explicitly, or --allow-stale-exposure to render anyway with a warning in the sidecar.')
        log('WARNING: ' + msg + ' Rendering anyway (--allow-stale-exposure).')
        rec['stale'] = True
    else:
        rec['stale'] = False
    return entry['exposure'], rec


# --- main -------------------------------------------------------------------------------------------------------------------
def build(args, view, studio_name, w, h):
    sc = clean_scene()
    root, by_board = import_glb(os.path.abspath(args.glb))
    mats = tune_materials(args.photo_rough_scale, args.photo_metal_f0)
    pts = board_points(by_board)
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2; centre.z = 0
    extent = math.hypot(hi.x - lo.x, hi.y - lo.y)
    if view in VIEWS: az, el, fill = VIEWS[view]
    else: az, el, fill = args.az, args.el, args.fill
    studio = build_studio(centre, extent, studio_name, ground=el >= 0)
    frame = frame_for(pts, dir_from_az_el(az, el), fill, w / h)
    cam = make_camera(frame, w / h)
    info = {'kit_bbox_m': {'min': [round(v, 5) for v in lo], 'max': [round(v, 5) for v in hi]},
            'materials_tuned': mats['summary'], 'materials': mats['per_material'],
            'view': {'name': view, 'az': az, 'el': el, 'fill': fill, 'fov_vertical_deg': FOV_V,
                     'camera_pos_m': [round(v, 5) for v in frame['pos']], 'target_m': [round(v, 5) for v in frame['target']], 'distance_m': round(frame['dist'], 5),
                     'note': 'same az/el, vertical fov, fill and bounding-box fit rule as the viewer presets (src/main.js VIEWS / frameFor, ported); '
                             'tools/blender/viewer-camera.mjs prints the viewer\'s own camera for the same aspect to compare'},
            'studio': {'preset': studio_name, **studio}}
    return sc, cam, info


def render_once(sc, out_path):
    sc.render.filepath = out_path
    t = time.time(); bpy.ops.render.render(write_still=True); dt = time.time() - t
    return dt


def match_photo(args, studio_name, stored, exposure_file, glb_sha, git):
    """Iterate the view exposure until the MEAN Rec.709 luminance of the two plain-mask patches equals the photo's, then store it pinned to the GLB."""
    key = f'{studio_name}/{args.view_transform}/{args.look}'
    mw, mh = (int(v) for v in args.match_size.lower().split('x'))
    sc, cam, info = build(args, 'hero', studio_name, mw, mh)
    exposure = args.exposure if args.exposure is not None else stored.get(key, {}).get('exposure', 0.0)
    target = np.mean([srgb_to_lum(v) for v in PHOTO_MEANS_SRGB.values()])
    tmp = os.path.join(args.out_dir, f'_match-{studio_name}.png'); os.makedirs(os.path.dirname(tmp), exist_ok=True)
    history = []; meas = {}
    for it in range(4):
        setup_render(sc, mw, mh, args.match_samples, exposure, args.view_transform, not args.no_denoise, 0, args.look)
        dt = render_once(sc, tmp)
        meas = measure_patches(sc, cam, tmp)
        got = [srgb_to_lum(m['mean_sRGB']) for m in meas.values() if m]
        if not got: raise SystemExit('no patch visible in the calibration view')
        lum = float(np.mean(got)); step = math.log2(target / max(lum, 1e-6))
        history.append({'iteration': it, 'exposure': round(exposure, 3), 'render_patches': meas, 'render_lum': round(lum, 5), 'photo_lum': round(float(target), 5), 'step_stops': round(step, 3), 'seconds': round(dt, 1)})
        log(f'match {studio_name} {it}: exposure={exposure:+.3f} render lum={lum:.4f} photo lum={target:.4f} -> step {step:+.3f} stops ({dt:.1f}s)')
        if abs(step) < 0.02: break
        exposure += step * 0.9
    stored[key] = {'exposure': round(exposure, 3), 'view_transform': args.view_transform, 'look': args.look,
                   'glb_sha256': glb_sha, 'glb': os.path.relpath(os.path.abspath(args.glb), ROOT), 'model_commit': git['model_commit'], 'model_dirty': git['dirty'],
                   'render_py_blob': git['render_py_blob'], 'calibrated_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'match_size': args.match_size, 'match_samples': args.match_samples,
                   'photo_patches_sRGB': PHOTO_MEANS_SRGB, 'render_patches_sRGB': {k: (m['mean_sRGB'] if m else None) for k, m in meas.items()},
                   'per_patch_stops_vs_photo': per_patch_stops(meas), 'history': history,
                   'method': 'MEAN luminance (Rec.709 from sRGB) of plain solder-mask patches A and B, rendered at ' + args.match_size + ' with the hero camera, vs the same physical '
                             'patches in source-photos/gallery-1.jpg. Mean-only: the two patches individually differ from the photo in opposite directions (per_patch_stops_vs_photo). '
                             'Valid only for the GLB named by glb_sha256.'}
    os.makedirs(os.path.dirname(os.path.abspath(exposure_file)), exist_ok=True)
    json.dump(stored, open(exposure_file, 'w'), indent=2)
    log(f'wrote {exposure_file}: {key} exposure {exposure:+.3f} (pinned to GLB {glb_sha[:12]}...)')


def render_frame(args, view, studio_name, out, samples, stored, exposure_file, glb_sha, git):
    key = f'{studio_name}/{args.view_transform}/{args.look}'
    exposure, exposure_src = resolve_exposure(args, stored, key, glb_sha, exposure_file)
    w, h = (int(v) for v in args.size.lower().split('x'))
    sc, cam, info = build(args, view, studio_name, w, h)
    setup_render(sc, w, h, samples, exposure, args.view_transform, not args.no_denoise, args.time_limit, args.look)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    log(f'rendering {view} ({studio_name}) {w}x{h} samples={samples} exposure={exposure:+.3f} {args.view_transform} denoise={not args.no_denoise} -> {out}')
    dt = render_once(sc, out)
    meas = measure_patches(sc, cam, out)
    log(f'done in {dt:.1f}s; patches: ' + ', '.join(f"{k}={m['mean_sRGB'] if m else 'off-frame'}" for k, m in meas.items()))
    sidecar = {
        'render': os.path.basename(out), 'size': [w, h], 'rendered_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'seconds': round(dt, 1),
        'engine': {'blender': bpy.app.version_string, 'renderer': 'Cycles CPU', 'samples_max': samples, 'adaptive_threshold': 0.01,
                   'denoiser': ('OpenImageDenoise RGB+albedo+normal' if sc.cycles.use_denoising else 'none'), 'view_transform': args.view_transform, 'look': args.look,
                   'exposure_stops': round(exposure, 3), 'exposure': exposure_src, 'threads': os.cpu_count()},
        'model': {'glb': os.path.relpath(os.path.abspath(args.glb), ROOT), 'glb_sha256': glb_sha, 'glb_bytes': os.path.getsize(args.glb),
                  **git, 'exporter': 'tools/export-glb.mjs (src/export.js)',
                  'note': 'model_commit is HEAD of the checkout; dirty=true means tracked files differed from it when this was rendered, so the GLB may not '
                          'correspond to that commit. render_py_blob is the git blob hash of tools/blender/render.py as run.'},
        **info,
        'colour_match': {'method': 'exposure matched so the MEAN luminance of two plain solder-mask patches equals the mean of the same patches in gallery-1.jpg (mean-only; the patches '
                                   'individually differ in opposite directions, see per_patch_stops_vs_photo). Hue is not matched: the rendered mask reads lighter and less saturated than the photo.',
                         'valid_for': 'the hero view only: in other views the patches are foreshortened or occluded and their numbers below mean nothing',
                         'photo_patches_sRGB': PHOTO_MEANS_SRGB, 'render_patches_sRGB': meas, 'per_patch_stops_vs_photo': per_patch_stops(meas)},
        'synthetic': 'Lighting (three area lights), world gradient, ground plane, camera, material gloss/coat and the denoiser are synthetic studio choices made for this render. They are not the lighting of the photographs.',
        'disclosure': disclosure_from_index(),
        'status_note': 'Illustrative, photo-anchored, NOT CAD. Board tops are the real gallery photographs; part heights, stack height, PCB thickness and colours of plastics and metals are assumed. Nothing here is a vendor-supplied mechanical specification or an independently verified capability.',
    }
    side = out[:-4] + '.json' if out.lower().endswith('.png') else out + '.json'
    json.dump(sidecar, open(side, 'w'), indent=2)
    log(f'wrote sidecar {side}')
    return sidecar


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--glb', default=os.path.join(ROOT, 'assets', 'unijack.glb'))
    ap.add_argument('--view', default='hero', help='hero|top|low|side|under|custom (custom uses --az --el --fill)')
    ap.add_argument('--all', action='store_true', help='render the six library frames in sequence: hero, low, top, side, under (dark studio) and hero-white (white studio) into --out-dir')
    ap.add_argument('--az', type=float, default=32); ap.add_argument('--el', type=float, default=34); ap.add_argument('--fill', type=float, default=0.9)
    ap.add_argument('--out', default=None, help='output PNG (default <out-dir>/<view>.png); a sidecar .json is written next to it')
    ap.add_argument('--out-dir', default=os.path.join(ROOT, 'renders'), help='directory for --all and for the default --out (default renders/)')
    ap.add_argument('--samples', type=int, default=128, help='adaptive max samples per pixel (with --all: every frame but hero)')
    ap.add_argument('--hero-samples', type=int, default=192, help='with --all: samples for the dark-studio hero frame')
    ap.add_argument('--size', default='1920x1080')
    ap.add_argument('--studio', default='dark', choices=['dark', 'white'])
    ap.add_argument('--exposure', type=float, default=None, help='view exposure in stops; default: the exposure.json entry for this studio, which must have been calibrated for this GLB')
    ap.add_argument('--exposure-file', default=os.path.join(HERE, 'exposure.json'), help='where --match-photo writes and renders read the calibrated exposure')
    ap.add_argument('--allow-stale-exposure', action='store_true', help='render with an exposure.json entry calibrated for a different GLB (warning in the sidecar) instead of refusing')
    ap.add_argument('--view-transform', default='AgX', choices=['AgX', 'Filmic', 'Standard'])
    ap.add_argument('--look', default='AgX - Base Contrast', help="view look, e.g. 'AgX - Base Contrast', 'AgX - Punchy', 'None'")
    ap.add_argument('--no-denoise', action='store_true'); ap.add_argument('--time-limit', type=float, default=0, help='seconds per frame, 0 = none')
    ap.add_argument('--photo-rough-scale', type=float, default=1.0, help='multiply the photo faces\' roughness map through a node (1 = the GLB\'s photo-derived map as is)')
    ap.add_argument('--photo-metal-f0', type=float, default=1.5, help='base colour gain of metal pixels on the photo faces (the viewer\'s ASSUMED PHOTO_METAL_F0: 1.5 was its first value and stays the default the existing renders were made with; the viewer uses 1.2 now; 1 = the plain photo colour)')
    ap.add_argument('--match-photo', action='store_true', help='iterate the exposure until the plain solder mask matches gallery-1.jpg, then write it to --exposure-file pinned to the GLB '
                                                             '(with --all: calibrate both studios first, then render)')
    ap.add_argument('--match-size', default='960x540'); ap.add_argument('--match-samples', type=int, default=32)
    args = ap.parse_args()
    if not os.path.exists(args.glb): raise SystemExit(f'[render] GLB not found: {args.glb} (run `node tools/export-glb.mjs`)')
    glb_sha = sha256(args.glb)
    git = git_info()
    if git['dirty']: log(f'NOTE: working tree has uncommitted changes in {len(git["dirty_files"])} tracked file(s); the sidecar says dirty=true')
    stored = load_exposures(args.exposure_file)

    if args.match_photo:
        for studio_name in (['dark', 'white'] if args.all else [args.studio]):
            match_photo(args, studio_name, stored, args.exposure_file, glb_sha, git)
            stored = load_exposures(args.exposure_file)
        if not args.all: return

    if args.all:
        t0 = time.time(); done = []
        for view, studio_name, name in LIBRARY:
            out = os.path.abspath(os.path.join(args.out_dir, f'{name}.png'))
            samples = args.hero_samples if (view == 'hero' and studio_name == 'dark') else args.samples
            sc = render_frame(args, view, studio_name, out, samples, stored, args.exposure_file, glb_sha, git)
            done.append((name, sc['seconds']))
        log('library batch done in %.0fs: ' % (time.time() - t0) + ', '.join(f'{n} {s:.0f}s' for n, s in done))
        return

    out = os.path.abspath(args.out or os.path.join(args.out_dir, f'{args.view}.png'))
    render_frame(args, args.view, args.studio, out, args.samples, stored, args.exposure_file, glb_sha, git)


if __name__ == '__main__':
    main()
