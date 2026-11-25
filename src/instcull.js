import * as THREE from 'three';

// Per-instance culling for scenery that is built once: trees, grass, pebbles, wire. A plain InstancedMesh
// is drawn whole, and its bounding sphere always covers the map, so every tree was sent to the GPU twice
// a frame (picture and shadow map) however little of it could be seen. This keeps the full list as a
// master copy and, each frame, packs just the instances the camera or the sun's shadow box can reach
// (and that are closer than `far`) into the front of the buffers. The shadow pass draws only the part
// that sits inside the shadow box (the same trick the soldiers and props use).
export class InstCull {
  // meshes: instanced meshes that share one instance order (a trunk and its crown). spheres: x, y, z, r per instance.
  constructor(meshes, spheres, { far = 0, shared = false } = {}) {
    this.meshes = meshes;
    this.s = spheres;
    this.n = spheres.length / 4;
    this.far = far; // 0 = the fog distance
    this.k = 0; // how many are in the shadow box
    this.vis = new Int32Array(this.n);
    this.tmp = new Int32Array(this.n);
    this.cnt = -1; this.kk = -1;
    this.mats = meshes.map((m) => m.instanceMatrix.array.slice());
    this.cols = meshes.map((m) => (m.instanceColor ? m.instanceColor.array.slice() : null));
    if (shared) for (let i = 1; i < meshes.length; i++) meshes[i].instanceMatrix = meshes[0].instanceMatrix;
    for (const m of meshes) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.visible = false;
      m.userData.casts = m.castShadow;
      const self = this;
      m.onBeforeShadow = () => { m._full = m.count; m.count = Math.min(m.count, self.k); };
      m.onAfterShadow = () => { m.count = m._full; };
    }
    this.shared = shared;
  }

  update(view) {
    const { s, n, tmp, vis } = this;
    const far = this.far || view.far;
    let c = 0, k = 0;
    for (let pass = 2; pass >= 1; pass--) {
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        if (view.test(s[j], s[j + 1], s[j + 2], s[j + 3], far) === pass) tmp[c++] = i;
      }
      if (pass === 2) k = c;
    }
    let same = c === this.cnt && k === this.kk;
    if (same) for (let i = 0; i < c; i++) if (vis[i] !== tmp[i]) { same = false; break; }
    if (same) return;
    this.cnt = c; this.kk = k; this.k = k;
    vis.set(tmp.subarray(0, c));
    this.meshes.forEach((m, mi) => {
      const src = this.mats[mi], dst = m.instanceMatrix.array, cs = this.cols[mi], cd = m.instanceColor?.array;
      const own = !(this.shared && mi > 0); // shared meshes read the first mesh's matrices
      for (let i = 0; i < c; i++) {
        if (own) { const a = vis[i] * 16, b = i * 16; for (let q = 0; q < 16; q++) dst[b + q] = src[a + q]; }
        if (cs) { const a3 = vis[i] * 3, b3 = i * 3; cd[b3] = cs[a3]; cd[b3 + 1] = cs[a3 + 1]; cd[b3 + 2] = cs[a3 + 2]; }
      }
      if (own) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, Math.max(16, c * 16)); m.instanceMatrix.needsUpdate = true; }
      if (m.instanceColor) { m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, Math.max(3, c * 3)); m.instanceColor.needsUpdate = true; }
      m.count = c; m.visible = c > 0;
      m.castShadow = m.userData.casts && k > 0; // an empty shadow draw is still a draw call
    });
  }
}

// An instanced mesh with nothing to draw still costs a draw call unless it is hidden. Many effects meshes
// (casings, blood drops, wound patches) sit at a count of zero most of the time, so each frame this hides
// the empty ones and shows them again as soon as they hold something. Meshes another system hid on purpose are left alone.
export class TrimEmpty {
  constructor(scene) { this.scene = scene; this.list = []; this.t = 0; }
  run() {
    if (this.t++ % 30 === 0) { this.list.length = 0; this.scene.traverse((o) => { if (o.isInstancedMesh) this.list.push(o); }); }
    for (const m of this.list) {
      if (m.count === 0) { if (m.visible) { m.visible = false; m.userData.trimmed = true; } }
      else if (m.userData.trimmed) { m.visible = true; m.userData.trimmed = false; }
    }
  }
}
