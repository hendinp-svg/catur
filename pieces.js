// pieces.js
// Builds figurative 3D chess pieces from Three.js primitives:
//  - knight  -> a real four-legged horse (body, legs, arched neck, head, ears, tail)
//  - king    -> a robed figure with a beard and a cross-topped crown
//  - queen   -> a gowned figure with a pointed coronet
//  - bishop  -> a robed figure with a mitre and a crozier staff
//  - rook    -> a stone castle tower with battlements
//  - pawn    -> a small armoured soldier with a crested helmet
//
// Each piece's many primitives are merged into at most two meshes (a "body"
// mesh and a metallic "accent" mesh) so the whole 32-piece set stays light.
// Local space: the piece stands on the y=0 plane and faces +z by default.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function part(list, geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], group = 'body' } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q,
    new THREE.Vector3(scale[0], scale[1], scale[2]));
  const g = geo.clone();
  g.applyMatrix4(m);
  list.push({ geo: g, group });
}

// Round, slightly tapered base shared by the standing figures.
function addBase(list, r = 0.34) {
  part(list, new THREE.CylinderGeometry(r * 0.93, r, 0.10, 36), { pos: [0, 0.05, 0] });
  part(list, new THREE.CylinderGeometry(r * 0.80, r * 0.93, 0.05, 36), { pos: [0, 0.125, 0] });
  // thin gold trim ring around the base
  part(list, new THREE.TorusGeometry(r * 0.86, 0.018, 10, 40),
    { pos: [0, 0.145, 0], rot: [Math.PI / 2, 0, 0], group: 'accent' });
}

function lathe(points, segments = 36) {
  const pts = points.map(p => new THREE.Vector2(p[0], p[1]));
  return new THREE.LatheGeometry(pts, segments);
}

// ---------------------------------------------------------------- PAWN
function buildPawn(list) {
  addBase(list, 0.30);
  // tunic / lower body
  part(list, lathe([[0.02, 0.15], [0.20, 0.16], [0.19, 0.30], [0.13, 0.45], [0.12, 0.52]]),
    { pos: [0, 0, 0] });
  // chest / torso
  part(list, new THREE.SphereGeometry(0.155, 18, 16), { pos: [0, 0.58, 0], scale: [1, 0.95, 0.85] });
  // shoulders
  part(list, new THREE.CylinderGeometry(0.15, 0.13, 0.08, 18), { pos: [0, 0.66, 0] });
  // arms
  part(list, new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12),
    { pos: [-0.16, 0.55, 0.02], rot: [0, 0, 0.18] });
  part(list, new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12),
    { pos: [0.16, 0.55, 0.02], rot: [0, 0, -0.18] });
  // neck + head
  part(list, new THREE.CylinderGeometry(0.05, 0.06, 0.06, 12), { pos: [0, 0.73, 0] });
  part(list, new THREE.SphereGeometry(0.10, 18, 16), { pos: [0, 0.83, 0] });
  // crested helmet (gold)
  part(list, new THREE.SphereGeometry(0.115, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    { pos: [0, 0.85, 0], group: 'accent' });
  part(list, new THREE.ConeGeometry(0.03, 0.10, 10), { pos: [0, 0.99, 0], group: 'accent' });
}

// ---------------------------------------------------------------- ROOK (tower)
function buildRook(list) {
  addBase(list, 0.34);
  // tower shaft
  part(list, new THREE.CylinderGeometry(0.25, 0.30, 0.62, 28), { pos: [0, 0.47, 0] });
  // stone courses
  part(list, new THREE.TorusGeometry(0.27, 0.022, 10, 36), { pos: [0, 0.30, 0], rot: [Math.PI / 2, 0, 0] });
  part(list, new THREE.TorusGeometry(0.255, 0.02, 10, 36), { pos: [0, 0.55, 0], rot: [Math.PI / 2, 0, 0] });
  // top band (gold)
  part(list, new THREE.CylinderGeometry(0.27, 0.255, 0.05, 28), { pos: [0, 0.80, 0], group: 'accent' });
  // crown rim of the tower
  part(list, new THREE.CylinderGeometry(0.28, 0.27, 0.06, 28), { pos: [0, 0.86, 0] });
  // battlements (merlons)
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    part(list, new THREE.BoxGeometry(0.11, 0.13, 0.10),
      { pos: [Math.cos(a) * 0.225, 0.95, Math.sin(a) * 0.225], rot: [0, -a, 0] });
  }
  // arched doorway hint (gold inset)
  part(list, new THREE.BoxGeometry(0.10, 0.18, 0.04),
    { pos: [0, 0.30, 0.285], group: 'accent' });
}

// ---------------------------------------------------------------- BISHOP
function buildBishop(list) {
  addBase(list, 0.31);
  // flowing robe
  part(list, lathe([[0.02, 0.13], [0.24, 0.15], [0.22, 0.32], [0.17, 0.58], [0.13, 0.80], [0.105, 0.92]]),
    { pos: [0, 0, 0] });
  // shoulder cape
  part(list, new THREE.ConeGeometry(0.17, 0.16, 24, 1, true), { pos: [0, 0.86, 0] });
  // head
  part(list, new THREE.SphereGeometry(0.092, 18, 16), { pos: [0, 1.0, 0] });
  // mitre (bishop's hat), gold, flattened front-to-back with a small finial
  part(list, new THREE.ConeGeometry(0.105, 0.30, 22),
    { pos: [0, 1.20, 0], scale: [1, 1, 0.62], group: 'accent' });
  part(list, new THREE.SphereGeometry(0.03, 12, 10), { pos: [0, 1.37, 0], group: 'accent' });
  // crozier staff with a curled top (gold)
  part(list, new THREE.CylinderGeometry(0.022, 0.022, 0.95, 12), { pos: [0.235, 0.55, 0.02], group: 'accent' });
  part(list, new THREE.TorusGeometry(0.06, 0.022, 10, 20, Math.PI * 1.5),
    { pos: [0.235, 1.04, 0.02], rot: [Math.PI / 2, 0, 0], group: 'accent' });
}

// ---------------------------------------------------------------- QUEEN
function buildQueen(list) {
  addBase(list, 0.34);
  // full gown
  part(list, lathe([[0.02, 0.14], [0.27, 0.16], [0.255, 0.34], [0.20, 0.62], [0.15, 0.86], [0.12, 1.0]]),
    { pos: [0, 0, 0] });
  // belt (gold)
  part(list, new THREE.TorusGeometry(0.155, 0.022, 10, 36), { pos: [0, 0.60, 0], rot: [Math.PI / 2, 0, 0], group: 'accent' });
  // slim arms folded toward front
  part(list, new THREE.CylinderGeometry(0.04, 0.04, 0.34, 12), { pos: [-0.15, 0.78, 0.06], rot: [0.5, 0, 0.25] });
  part(list, new THREE.CylinderGeometry(0.04, 0.04, 0.34, 12), { pos: [0.15, 0.78, 0.06], rot: [0.5, 0, -0.25] });
  // neck + head
  part(list, new THREE.CylinderGeometry(0.05, 0.06, 0.07, 12), { pos: [0, 1.04, 0] });
  part(list, new THREE.SphereGeometry(0.10, 18, 16), { pos: [0, 1.15, 0] });
  // coronet band + points (gold)
  part(list, new THREE.CylinderGeometry(0.115, 0.115, 0.07, 20), { pos: [0, 1.27, 0], group: 'accent' });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    part(list, new THREE.ConeGeometry(0.028, 0.10, 10),
      { pos: [Math.cos(a) * 0.10, 1.34, Math.sin(a) * 0.10], group: 'accent' });
  }
  part(list, new THREE.SphereGeometry(0.034, 12, 10), { pos: [0, 1.40, 0], group: 'accent' });
}

// ---------------------------------------------------------------- KING
function buildKing(list) {
  addBase(list, 0.35);
  // long robe
  part(list, lathe([[0.02, 0.14], [0.28, 0.16], [0.265, 0.36], [0.21, 0.64], [0.17, 0.90], [0.145, 1.06]]),
    { pos: [0, 0, 0] });
  // belt (gold)
  part(list, new THREE.TorusGeometry(0.165, 0.024, 10, 36), { pos: [0, 0.62, 0], rot: [Math.PI / 2, 0, 0], group: 'accent' });
  // cape collar over shoulders
  part(list, new THREE.ConeGeometry(0.19, 0.16, 26, 1, true), { pos: [0, 0.98, 0] });
  // slim arms
  part(list, new THREE.CylinderGeometry(0.045, 0.045, 0.36, 12), { pos: [-0.17, 0.82, 0.05], rot: [0.35, 0, 0.22] });
  part(list, new THREE.CylinderGeometry(0.045, 0.045, 0.36, 12), { pos: [0.17, 0.82, 0.05], rot: [0.35, 0, -0.22] });
  // neck + head
  part(list, new THREE.CylinderGeometry(0.055, 0.065, 0.07, 12), { pos: [0, 1.10, 0] });
  part(list, new THREE.SphereGeometry(0.105, 18, 16), { pos: [0, 1.21, 0] });
  // beard
  part(list, new THREE.ConeGeometry(0.075, 0.16, 14), { pos: [0, 1.13, 0.07], rot: [Math.PI, 0, 0] });
  // crown band + merlons (gold)
  part(list, new THREE.CylinderGeometry(0.125, 0.125, 0.09, 22), { pos: [0, 1.34, 0], group: 'accent' });
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    part(list, new THREE.BoxGeometry(0.05, 0.08, 0.05),
      { pos: [Math.cos(a) * 0.115, 1.41, Math.sin(a) * 0.115], rot: [0, -a, 0], group: 'accent' });
  }
  // surmounting cross (gold)
  part(list, new THREE.CylinderGeometry(0.028, 0.028, 0.10, 14), { pos: [0, 1.46, 0], group: 'accent' });
  part(list, new THREE.BoxGeometry(0.035, 0.16, 0.035), { pos: [0, 1.58, 0], group: 'accent' });
  part(list, new THREE.BoxGeometry(0.11, 0.035, 0.035), { pos: [0, 1.58, 0], group: 'accent' });
}

// ---------------------------------------------------------------- KNIGHT (horse)
function buildKnight(list) {
  addBase(list, 0.34);
  // legs
  const legR = 0.052;
  const legs = [[-0.12, 0.17], [0.12, 0.17], [-0.12, -0.17], [0.12, -0.17]];
  for (const [x, z] of legs) {
    part(list, new THREE.CylinderGeometry(legR, legR + 0.012, 0.52, 12), { pos: [x, 0.34, z] });
    // hoof
    part(list, new THREE.CylinderGeometry(0.072, 0.078, 0.07, 12), { pos: [x, 0.10, z] });
  }
  // barrel body
  part(list, new THREE.SphereGeometry(0.22, 22, 18), { pos: [0, 0.64, -0.02], scale: [0.9, 0.92, 1.45] });
  // chest
  part(list, new THREE.SphereGeometry(0.18, 20, 16), { pos: [0, 0.66, 0.26], scale: [0.95, 0.95, 0.9] });
  // hindquarters
  part(list, new THREE.SphereGeometry(0.205, 20, 16), { pos: [0, 0.62, -0.30], scale: [0.95, 1.0, 0.9] });
  // arched neck (leaning forward)
  part(list, new THREE.CylinderGeometry(0.085, 0.15, 0.46, 16),
    { pos: [0, 0.94, 0.40], rot: [0.62, 0, 0] });
  // head
  part(list, new THREE.BoxGeometry(0.135, 0.17, 0.24),
    { pos: [0, 1.16, 0.56], rot: [0.45, 0, 0] });
  // muzzle
  part(list, new THREE.BoxGeometry(0.10, 0.10, 0.16),
    { pos: [0, 1.04, 0.73], rot: [0.55, 0, 0] });
  // ears
  part(list, new THREE.ConeGeometry(0.036, 0.10, 8), { pos: [-0.055, 1.28, 0.50], rot: [-0.2, 0, 0] });
  part(list, new THREE.ConeGeometry(0.036, 0.10, 8), { pos: [0.055, 1.28, 0.50], rot: [-0.2, 0, 0] });
  // mane along the neck
  part(list, new THREE.BoxGeometry(0.05, 0.5, 0.085),
    { pos: [0, 0.97, 0.30], rot: [0.62, 0, 0] });
  // forelock + tail
  part(list, new THREE.ConeGeometry(0.05, 0.16, 10), { pos: [0, 1.30, 0.55], rot: [0.4, 0, 0] });
  part(list, new THREE.CylinderGeometry(0.03, 0.085, 0.42, 12),
    { pos: [0, 0.46, -0.46], rot: [-0.5, 0, 0] });
}

const BUILDERS = { p: buildPawn, r: buildRook, n: buildKnight, b: buildBishop, q: buildQueen, k: buildKing };

/**
 * Create a piece as a THREE.Group with up to two merged meshes.
 * @param {string} type one of p,n,b,r,q,k
 * @param {{body: THREE.Material, accent: THREE.Material}} materials
 */
export function createPieceMesh(type, materials) {
  const list = [];
  (BUILDERS[type] || buildPawn)(list);

  const byGroup = { body: [], accent: [] };
  for (const it of list) byGroup[it.group].push(it.geo);

  const group = new THREE.Group();
  for (const key of ['body', 'accent']) {
    if (!byGroup[key].length) continue;
    const merged = mergeGeometries(byGroup[key], false);
    const mesh = new THREE.Mesh(merged, key === 'body' ? materials.body : materials.accent);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  // free temporary geometries
  for (const it of list) it.geo.dispose();
  return group;
}
