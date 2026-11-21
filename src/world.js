import * as THREE from 'three';

export const PLATE = { size: 48, thick: 0.6, bevel: 0.12, top: 0 };

function plateTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#a9aaa5';
  g.fillRect(0, 0, S, S);
  // speckle so the stone doesn't read as flat plastic
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const l = 0.86 + rnd() * 0.22;
    g.fillStyle = `rgba(${Math.round(120 * l)},${Math.round(121 * l)},${Math.round(116 * l)},${0.08 + rnd() * 0.12})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  // 4x4 tiles per texture repeat, with grout lines
  const tile = S / 4;
  g.strokeStyle = 'rgba(88,89,85,0.45)';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * tile, 0); g.lineTo(i * tile, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * tile); g.lineTo(S, i * tile); g.stroke();
  }
  g.strokeStyle = 'rgba(235,236,232,0.2)';
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * tile + 2.5, 0); g.lineTo(i * tile + 2.5, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * tile + 2.5); g.lineTo(S, i * tile + 2.5); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function createBaseplate() {
  const { size, thick, bevel } = PLATE;
  const h = size / 2 - bevel, r = 0.6;
  const shape = new THREE.Shape();
  shape.moveTo(-h + r, -h);
  shape.lineTo(h - r, -h); shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r); shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h); shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r); shape.quadraticCurveTo(-h, -h, -h + r, -h);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.max.y, 0); // top face at y = 0
  geo.computeBoundingBox();
  const tex = plateTexture();
  tex.repeat.set(1 / 8, 1 / 8); // one texture = 8m, tiles are 2m
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
  const side = new THREE.MeshStandardMaterial({ color: '#7e7f7a', roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, [top, side]);
  mesh.name = 'baseplate';
  mesh.receiveShadow = true;
  return mesh;
}

// Axis-aligned box collider for the plate.
export const PLATE_COLLIDER = new THREE.Box3(
  new THREE.Vector3(-PLATE.size / 2, -PLATE.thick, -PLATE.size / 2),
  new THREE.Vector3(PLATE.size / 2, 0, PLATE.size / 2),
);

export function createSky() {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#b9bdbf') },
      mid: { value: new THREE.Color('#d3d4d1') },
      low: { value: new THREE.Color('#bcbdb9') },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0.0 ? mix(mid, top, smoothstep(0.0,0.55,h)) : mix(mid, low, smoothstep(0.0,0.2,-h)); gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}',
  });
  const sky = new THREE.Mesh(geo, m);
  sky.name = 'sky';
  sky.frustumCulled = false;
  return sky;
}
