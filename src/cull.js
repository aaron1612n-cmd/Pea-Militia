import * as THREE from 'three';

// What can the picture reach this frame? Tests spheres against the camera's view and against the
// sun's shadow box (a soldier behind you can still cast a shadow into view), and drops anything
// past the fog, where it is already the colour of the haze. Used to leave out instances before
// they are sent to the GPU: instanced meshes are drawn whole, so nothing else culls them.
export class View {
  constructor() {
    this.cam = new THREE.Frustum();
    this.sun = new THREE.Frustum();
    this.m = new THREE.Matrix4();
    this.eye = new THREE.Vector3();
    this.shadows = true;
    this.far = 250;
  }
  // call once per frame after the camera and the sun are placed
  update(camera, sun, fogFar) {
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.cam.setFromProjectionMatrix(this.m);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.far = fogFar + 12;
    this.shadows = !!sun?.castShadow;
    if (this.shadows) {
      sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      const c = sun.shadow.camera;
      this.m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      this.sun.setFromProjectionMatrix(this.m);
    }
  }
  inView(x, y, z, r) {
    const p = this.cam.planes;
    for (let i = 0; i < 6; i++) {
      const pl = p[i], n = pl.normal;
      if (n.x * x + n.y * y + n.z * z + pl.constant < -r) return false;
    }
    return true;
  }
  inShadow(x, y, z, r) {
    const p = this.sun.planes;
    for (let i = 0; i < 6; i++) {
      const pl = p[i], n = pl.normal;
      if (n.x * x + n.y * y + n.z * z + pl.constant < -r) return false;
    }
    return true;
  }
  // 0: leave it out; 1: draw it in the picture; 2: the sun's shadow box holds it too, so it also goes into the shadow map
  // (far: leave out anything past this distance from the eye, which defaults to the fog)
  test(x, y, z, r, far = this.far) {
    const dx = x - this.eye.x, dy = y - this.eye.y, dz = z - this.eye.z;
    const lim = far + r;
    if (dx * dx + dy * dy + dz * dz > lim * lim) return 0;
    if (this.shadows && this.inShadow(x, y, z, r)) return 2;
    return this.inView(x, y, z, r) ? 1 : 0;
  }
  sees(x, y, z, r, far = this.far) { return this.test(x, y, z, r, far) > 0; }
}
