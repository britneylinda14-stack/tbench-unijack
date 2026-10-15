import * as THREE from 'three';

/**
 * A board-local coordinate frame built from a photo texture.
 *
 * Board-local axes (all parts use this): +x = right in the photo, +z = DOWN in the photo,
 * +y = up (out of the board). Origin = centre of the board's top surface. The top surface is y = 0;
 * the PCB body occupies y in [-thickness, 0]; components are extruded upward from y = 0.
 *
 * `wpx`,`hpx` = texture size in pixels, `s` = texture pixels per millimetre.
 */
export function makeFrame([wpx, hpx], s) {
  const f = {
    wpx, hpx, s,
    W: wpx / s,            // board width  (mm)
    D: hpx / s,            // board depth  (mm)
    x: (px) => (px - wpx / 2) / s,   // texture px -> board-local x (mm)
    z: (py) => (py - hpx / 2) / s,   // texture py -> board-local z (mm)
    len: (p) => p / s,               // pixel length -> mm
    /** pixel bbox [x0,y0,x1,y1] -> { cx, cz, w, d } in mm (board-local) */
    box(b) {
      const [x0, y0, x1, y1] = b;
      return { cx: f.x((x0 + x1) / 2), cz: f.z((y0 + y1) / 2), w: (x1 - x0) / s, d: (y1 - y0) / s };
    },
  };
  return f;
}

/**
 * Overwrite a geometry's UVs with a planar projection from above, so a vertex at board-local (x,z)
 * samples the photo exactly where the photo shows that point. Used for the TOP faces of extruded
 * components: their tops then look like the real part in the photo while the geometry gives depth.
 * `pos`/`rotY` are the mesh's position and Y rotation inside the board group.
 */
export function planarUV(geometry, frame, pos = [0, 0, 0], rotY = 0, { mirrorBottom = false } = {}) {
  const p = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), lz = p.getZ(i);
    const wx = pos[0] + c * lx + s * lz;
    const wz = pos[2] - s * lx + c * lz;
    let u = (wx + frame.W / 2) / frame.W;
    // a photo of a board's BACK, viewed from below, is mirrored in x relative to the top-down frame
    if (mirrorBottom && nrm && nrm.getY(i) < -0.5) u = 1 - u;
    uv[2 * i] = u;
    uv[2 * i + 1] = 1 - (wz + frame.D / 2) / frame.D;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
