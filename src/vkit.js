import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { uberMaterial, UBER_KIND as K } from './grime.js';
import { LOD } from './shapes.js';
import { profile } from './models.js';

// The piece builder for vehicles. A machine is a handful of CKits, one per moving part (a thigh, a turret,
// a road wheel); each part is built in its own frame, then every kit is merged into ONE skinned mesh whose
// skeleton is the machine's joints, so the whole body is a single draw call however many parts it has.
// Pieces carry their paint and wear for the uber material (grime.js), a dab of mud toward the ground and a
// little tone variation. Small pieces are tagged `minor` and left out of the far copy; pieces tagged with a
// damage tier are baked into a separate overlay that is drawn only once the machine is hurt that badly.
export const VEHICLES = {};
export const clamp = THREE.MathUtils.clamp;

// a paint: its colour and what it is made of (drives the uber material's kind, roughness and metalness)
export const P = (hex, m = 'steel') => ({ hex, m });
export const C = {
  steel: P('#3b3e3d'), dark: P('#26292a'), iron: P('#4a4a45'), brass: P('#9c7a3c', 'brass'), copper: P('#8a5236', 'copper'),
  rubber: P('#1d1d1c', 'rubber'), canvas: P('#7d7559', 'cloth'), wood: P('#6a4a2f', 'cloth'), glass: P('#2c4947', 'glass'),
  scorch: P('#151413', 'rubber'), bare: P('#8d8f8c', 'bare'), olive: P('#4f5640'),
};
const AP = {
  brass: [K.plain, 0.36, 0.85], copper: [K.plain, 0.4, 0.8], rubber: [K.plain, 0.95, 0.0], glass: [K.plain, 0.12, 0.3], bare: [K.plain, 0.5, 0.9],
};
const MUD = new THREE.Color('#4b4333');
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export const BODY = uberMaterial();
export const WRECK = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#3c3835', roughness: 0.95, metalness: 0.1 });

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
let pieceNo = 0;

export class CKit {
  // bone: the joint these pieces ride; anchor: where that joint is in the bind pose (so the shader's
  // object-space wear and dirt see the part where it stands); mud: how much ground dirt it gathers
  constructor(name = '', bone = 0, anchor = [0, 0, 0], mud = 1) {
    this.list = []; this.name = name; this.bone = bone; this.anchor = anchor; this.mud = mud;
  }
  // o: pos, rot, scale, wear (0..1 how beaten up), minor (left out of the far copy), tier (1|2: a damage overlay piece),
  //    blend { a, b, t(x, y, z) -> 0..1 } (a flexible piece skinned between two joints; its geometry is given in bind space)
  add(geo, color, o = {}) {
    const paint = typeof color === 'string' ? P(color) : color;
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = o.pos || [0, 0, 0], rot = o.rot || [0, 0, 0], sc = o.scale ?? 1;
    _m.compose(_v.set(...pos), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), Array.isArray(sc) ? _s.set(...sc) : _s.setScalar(sc));
    g.applyMatrix4(_m);
    const n = g.attributes.position.count, p = g.attributes.position;
    const base = _c.set(paint.hex).clone();
    const jit = (hash(++pieceNo) - 0.5) * 0.14;
    const col = new Float32Array(n * 3), ap = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const kind = AP[paint.m] || (paint.m === 'cloth' ? [K.cloth, o.wear ?? 0.3, 0] : [K.metal, o.wear ?? 0.2, 0]);
    const ay = o.blend ? 0 : (this.standY ?? this.anchor[1]);
    for (let i = 0; i < n; i++) {
      const y = p.getY(i) + ay;
      const mud = clamp(1 - y / 0.95, 0, 1) * 0.42 * this.mud * (paint.m === 'rubber' ? 0.5 : 1);
      _c.copy(base).multiplyScalar(1 + jit).lerp(MUD, mud);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      ap[i * 3] = kind[0]; ap[i * 3 + 1] = kind[1]; ap[i * 3 + 2] = kind[2];
      if (o.blend) {
        const w = clamp(o.blend.t(p.getX(i), p.getY(i), p.getZ(i)), 0, 1);
        si[i * 4] = o.blend.a; si[i * 4 + 1] = o.blend.b; sw[i * 4] = 1 - w; sw[i * 4 + 1] = w;
      } else { si[i * 4] = this.bone; sw[i * 4] = 1; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aP', new THREE.BufferAttribute(ap, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!o.blend) { const a = this.anchor; g.translate(a[0], a[1], a[2]); }
    const piece = { g, minor: !!o.minor, tier: o.tier || 0, blend: !!o.blend };
    this.list.push(piece);
    CKit.log?.push({ kit: this, g, blend: !!o.blend, minor: !!o.minor, tier: o.tier || 0, far: LOD.q < 1 }); // the model checks list every piece
    return this;
  }
}

// Build a machine twice: in full, and again with LOD.q turned down (fewer segments, no bevels) for the far copy.
// build() returns { kits, ...whatever else }; the far build's kits are only used for their non-minor pieces.
export function buildLods(build, q = 0.45) {
  const near = build();
  LOD.q = q;
  let far;
  try { far = build(); } finally { LOD.q = 1; }
  return { near, far };
}
const lq = (n, min = 5) => (LOD.q < 1 ? Math.max(min, Math.round(n * LOD.q)) : n);

// merge kits into the full mesh, the far copy (no minor pieces, built from farKits when given) and the damage overlay
export function bakeKits(kits, farKits = null) {
  const near = [], far = [], t1 = [], t2 = [];
  for (const k of kits) for (const pc of k.list) {
    if (pc.tier === 1) t1.push(pc.g); else if (pc.tier === 2) t2.push(pc.g);
    else { near.push(pc.g); if (!pc.minor && !farKits) far.push(pc.g); }
  }
  if (farKits) for (const k of farKits) for (const pc of k.list) if (!pc.tier && !pc.minor) far.push(pc.g);
  const mg = (l) => (l.length ? mergeGeometries(l, false) : null);
  const verts = (l) => l.reduce((s, g) => s + g.attributes.position.count, 0);
  const dmg = mg([...t1, ...t2]);
  return { near: mg(near), far: mg(far), dmg, dmgCount: [verts(t1), verts(t1) + verts(t2)] };
}

// bones from a spec [{ name, parent (index or -1), anchor }]: parentless bones hang off root. Bones rest at their anchors.
export function makeSkeleton(root, spec) {
  const bones = spec.map((s) => { const b = new THREE.Bone(); b.name = s.name; return b; });
  spec.forEach((s, i) => {
    const par = s.parent >= 0 ? spec[s.parent].anchor : [0, 0, 0];
    bones[i].position.set(s.anchor[0] - par[0], s.anchor[1] - par[1], s.anchor[2] - par[2]);
    (s.parent >= 0 ? bones[s.parent] : root).add(bones[i]);
  });
  const inv = spec.map((s) => new THREE.Matrix4().makeTranslation(-s.anchor[0], -s.anchor[1], -s.anchor[2]));
  root.updateMatrixWorld(true);
  return new THREE.Skeleton(bones, inv);
}

// The skinned meshes of one machine: the body (swaps to the far geometry at a distance), a hidden far copy that
// bullet marks are traced against (cheap, and it follows the bones), and the damage overlay.
export function skinnedBody(root, skeleton, baked, { radius = 8, centre = [0, 2, 0], material = BODY } = {}) {
  const sph = new THREE.Sphere(new THREE.Vector3(...centre), radius);
  const box = new THREE.Box3().setFromCenterAndSize(sph.center, new THREE.Vector3(radius * 2, radius * 2, radius * 2));
  const mk = (geo) => {
    const m = new THREE.SkinnedMesh(geo, material);
    m.castShadow = true; m.receiveShadow = true;
    m.bind(skeleton, new THREE.Matrix4());
    m.boundingSphere = sph.clone(); m.boundingBox = box.clone();
    root.add(m);
    return m;
  };
  const body = mk(baked.near), hit = mk(baked.far || baked.near);
  hit.visible = false; hit.castShadow = false;
  hit.name = 'hit-proxy';
  let dmg = null;
  if (baked.dmg) { dmg = mk(baked.dmg); dmg.visible = false; dmg.castShadow = false; dmg.name = 'damage'; }
  const geo = { near: baked.near, far: baked.far || baked.near };
  const st = { tier: 0, shown: true, lod: 0 };
  const apply = () => {
    body.visible = st.shown;
    if (dmg) dmg.visible = st.shown && st.tier > 0;
  };
  return {
    body, hit, dmg, geo, state: st,
    // 0 near, 1 far geometry, 2 far geometry and no shadow
    setLod(level) {
      st.lod = level;
      const g = level > 0 ? geo.far : geo.near;
      if (body.geometry !== g) body.geometry = g;
      body.castShadow = level < 2;
    },
    // 0 sound, 1 hurt, 2 badly hurt: how much of the damage overlay shows
    setDamage(tier) {
      if (!dmg) return;
      st.tier = tier;
      if (tier > 0) dmg.geometry.setDrawRange(0, baked.dmgCount[tier - 1]);
      apply();
    },
    // false while the camera is inside the machine
    show(on) { st.shown = on; apply(); },
  };
}

// ---- small shared shapes: plain boxes are 12 triangles, so seams, plates and slats use these, not rounded blocks
export const slab = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, lq(seg));
export const cone = (r0, r1, len, seg = 14) => new THREE.CylinderGeometry(r1, r0, len, lq(seg));
// a box with its four long edges chamfered: crates, plates and housings, 28 triangles apiece, not hundreds
export function blk(w, h, d, r = 0.03) {
  const hz = d / 2, hy = h / 2, c = Math.min(r * 0.7, hz - 0.001, hy - 0.001, 0.08);
  return profile([[-hz + c, -hy], [hz - c, -hy], [hz, -hy + c], [hz, hy - c], [hz - c, hy], [-hz + c, hy], [-hz, hy - c], [-hz, -hy + c]], w, 0, 1);
}
// a half-round shell standing over an axle along x (an arch), from angle a0 to a1 (0 = +z, up is +y)
export function arch(r0, r1, w, a0, a1, seg0 = 10) {
  const seg = lq(seg0, 4);
  const pts = [];
  for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * i / seg; pts.push([Math.sin(a) * r1, Math.cos(a) * r1]); }
  for (let i = seg; i >= 0; i--) { const a = a0 + (a1 - a0) * i / seg; pts.push([Math.sin(a) * r0, Math.cos(a) * r0]); }
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -w / 2); g.rotateY(-Math.PI / 2);
  return g;
}
// a tube of flexible hose between joints, skinned smoothly from joint a to joint b (points in bind space)
export function hoseCurve(points, r, seg = 14, radial = 6) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(c, seg, r, radial, false);
}
