// app.js — 3D chess: scene, board, interaction, animation, AI, and UI glue.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Chess, WHITE, BLACK, BITS, squareName } from './chess-engine.js';
import { pickMove } from './ai.js';
import { createPieceMesh } from './pieces.js';

const $ = (id) => document.getElementById(id);

// ----- Game / UI state -----
const engine = new Chess();
let mode = 'ai';          // 'ai' | '2p'
let level = 'medium';     // 'easy' | 'medium' | 'hard'
let humanColor = WHITE;   // which side the human plays in AI mode
let soundOn = true;

let selectedSquare = null;
let legalForSelected = [];
let busy = false;         // blocks input during animation / AI thinking
let gameOver = false;

// ----- Three.js core -----
let renderer, scene, camera, controls;
let piecesGroup, tilesGroup, highlightsGroup;
const tileMeshes = [];
const pieceMeshes = new Map(); // square (0x88) -> THREE.Group
let selectMarker, checkMarker;
const tweens = [];
const clock = new THREE.Clock();

const COLORS = {
  lightSq: 0xe9d3a3,
  darkSq: 0x70492a,
  frame: 0x35220f,
  border: 0x83592f,
  whiteBody: 0xefe6d0,
  blackBody: 0x22222a,
  gold: 0xc7a049,
  highlight: 0xe8c46a,
  capture: 0xd9534f,
  check: 0xd84b45,
};

let MAT; // materials, filled in setup

// Map a 0x88 square to world coords (x, z). White (rank 0/1) sits at +z (near).
function squareToWorld(sq) {
  const f = sq & 7, r = sq >> 4;
  return { x: f - 3.5, z: 3.5 - r };
}

// ---------------------------------------------------------------- setup
function setup() {
  const stage = $('stage');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  // Subtle environment for realistic metal/ivory shading.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch (e) { /* lights below are enough */ }

  camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.1, 200);
  setCameraToSide(WHITE, true);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.45, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.rotateSpeed = 0.9;
  controls.minDistance = 6;
  controls.maxDistance = 22;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = 1.45;
  controls.update();

  // Lights.
  const key = new THREE.DirectionalLight(0xfff3df, 2.1);
  key.position.set(5.5, 11, 6.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9fb6d6, 0.5);
  fill.position.set(-6, 5, -4);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xfff1da, 0x140d06, 0.45));

  // Materials.
  MAT = {
    white: {
      body: new THREE.MeshStandardMaterial({ color: COLORS.whiteBody, roughness: 0.5, metalness: 0.05 }),
      accent: new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.3, metalness: 0.92 }),
    },
    black: {
      body: new THREE.MeshStandardMaterial({ color: COLORS.blackBody, roughness: 0.42, metalness: 0.2 }),
      accent: new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.3, metalness: 0.92 }),
    },
  };

  buildBoard();

  piecesGroup = new THREE.Group();
  scene.add(piecesGroup);
  highlightsGroup = new THREE.Group();
  scene.add(highlightsGroup);

  // selection + check markers (reused)
  const sg = new THREE.PlaneGeometry(0.96, 0.96);
  selectMarker = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
    color: COLORS.highlight, transparent: true, opacity: 0.4, depthWrite: false,
  }));
  selectMarker.rotation.x = -Math.PI / 2;
  selectMarker.position.y = 0.012;
  selectMarker.visible = false;
  scene.add(selectMarker);

  checkMarker = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
    color: COLORS.check, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  checkMarker.rotation.x = -Math.PI / 2;
  checkMarker.position.y = 0.013;
  checkMarker.visible = false;
  scene.add(checkMarker);

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown, { passive: true });
  renderer.domElement.addEventListener('pointerup', onPointerUp, { passive: true });

  animate();
}

// Position the camera on a given side, fitting the board to the viewport.
function setCameraToSide(color, instant) {
  const stage = $('stage');
  const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  const radius = Math.min(Math.max(9 / Math.sqrt(Math.min(aspect, 1)), 9), 14.5);
  const polar = 0.92; // ~53° from vertical
  const azimuth = color === WHITE ? 0 : Math.PI; // white views from +z
  const tgt = new THREE.Vector3(0, 0.45, 0);
  const pos = new THREE.Vector3(
    tgt.x + radius * Math.sin(polar) * Math.sin(azimuth),
    tgt.y + radius * Math.cos(polar),
    tgt.z + radius * Math.sin(polar) * Math.cos(azimuth)
  );
  if (instant || !controls) {
    camera.position.copy(pos);
    camera.lookAt(tgt);
  } else {
    tweenCamera(pos);
  }
}

function buildBoard() {
  const board = new THREE.Group();

  // table shadow-catcher
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ opacity: 0.34 })
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.58;
  table.receiveShadow = true;
  scene.add(table);

  // frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(9.5, 0.55, 9.5),
    new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.55, metalness: 0.12 })
  );
  frame.position.y = -0.30;
  frame.castShadow = true;
  frame.receiveShadow = true;
  board.add(frame);

  // inner border ring (lighter wood) just around the 8x8 area
  const borderMat = new THREE.MeshStandardMaterial({ color: COLORS.border, roughness: 0.5, metalness: 0.15 });
  const bThick = 0.36, bLen = 8 + bThick * 2, y = -0.04;
  const mk = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), borderMat);
    m.position.set(x, y, z); m.receiveShadow = true; board.add(m);
  };
  mk(bLen, bThick, 0, 4 + bThick / 2);
  mk(bLen, bThick, 0, -(4 + bThick / 2));
  mk(bThick, 8, 4 + bThick / 2, 0);
  mk(bThick, 8, -(4 + bThick / 2), 0);

  // tiles
  tilesGroup = new THREE.Group();
  const lightMat = new THREE.MeshStandardMaterial({ color: COLORS.lightSq, roughness: 0.62, metalness: 0.04 });
  const darkMat = new THREE.MeshStandardMaterial({ color: COLORS.darkSq, roughness: 0.62, metalness: 0.06 });
  const tileGeo = new THREE.BoxGeometry(1.0, 0.3, 1.0);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const dark = (f + r) % 2 === 0;
      const tile = new THREE.Mesh(tileGeo, dark ? darkMat : lightMat);
      const { x, z } = squareToWorld(r * 16 + f);
      tile.position.set(x, -0.15, z);
      tile.receiveShadow = true;
      tile.userData = { square: r * 16 + f, isTile: true };
      tilesGroup.add(tile);
      tileMeshes.push(tile);
    }
  }
  board.add(tilesGroup);

  addCoordinateLabels(board);
  scene.add(board);
}

function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(232,213,166,0.85)';
  ctx.font = 'bold 40px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function addCoordinateLabels(board) {
  const files = 'abcdefgh';
  const geo = new THREE.PlaneGeometry(0.34, 0.34);
  for (let f = 0; f < 8; f++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: makeLabelTexture(files[f]), transparent: true, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(f - 3.5, -0.02, 4.18);
    board.add(m);
  }
  for (let r = 0; r < 8; r++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: makeLabelTexture(String(r + 1)), transparent: true, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(-4.18, -0.02, 3.5 - r);
    board.add(m);
  }
}

// ---------------------------------------------------------------- pieces
function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  piecesGroup.remove(g);
}

function orientPiece(g, color) {
  g.rotation.y = color === WHITE ? Math.PI : 0;
}

function spawnPieces() {
  for (const g of pieceMeshes.values()) disposeGroup(g);
  pieceMeshes.clear();
  for (const p of engine.pieces()) {
    const g = createPieceMesh(p.type, MAT[p.color === WHITE ? 'white' : 'black']);
    const { x, z } = squareToWorld(p.square);
    g.position.set(x, 0, z);
    orientPiece(g, p.color);
    g.userData = { square: p.square, color: p.color, type: p.type };
    piecesGroup.add(g);
    pieceMeshes.set(p.square, g);
  }
}

// ---------------------------------------------------------------- interaction
let pdInfo = null;
function onPointerDown(e) {
  pdInfo = { x: e.clientX, y: e.clientY, t: performance.now() };
}
function onPointerUp(e) {
  if (!pdInfo) return;
  const dx = e.clientX - pdInfo.x, dy = e.clientY - pdInfo.y;
  const moved = Math.hypot(dx, dy);
  const dt = performance.now() - pdInfo.t;
  pdInfo = null;
  if (moved < 7 && dt < 350) handleTap(e.clientX, e.clientY);
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function handleTap(clientX, clientY) {
  ensureAudio();
  if (busy || gameOver) return;
  if (!isHumanTurn()) return;

  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObjects([piecesGroup, tilesGroup], true);
  if (!hits.length) { deselect(); return; }
  let o = hits[0].object;
  while (o && !(o.userData && 'square' in o.userData)) o = o.parent;
  if (!o) { deselect(); return; }
  onSquare(o.userData.square);
}

function onSquare(sq) {
  const piece = engine.get(sq);
  if (selectedSquare === null) {
    if (piece && piece.color === engine.turn) select(sq);
    return;
  }
  if (sq === selectedSquare) { deselect(); return; }

  const moves = legalForSelected.filter((m) => m.to === sq);
  if (moves.length) {
    if (moves.length > 1 && (moves[0].flags & BITS.PROMOTION)) {
      askPromotion(moves);
    } else {
      const m = moves[0];
      deselect();
      doMove(m);
    }
    return;
  }
  if (piece && piece.color === engine.turn) { select(sq); return; }
  deselect();
}

function select(sq) {
  selectedSquare = sq;
  legalForSelected = engine.moves({ square: sq });
  const { x, z } = squareToWorld(sq);
  selectMarker.position.set(x, 0.012, z);
  selectMarker.visible = true;
  buildHighlights();
}

function deselect() {
  selectedSquare = null;
  legalForSelected = [];
  selectMarker.visible = false;
  clearHighlights();
}

function clearHighlights() {
  for (let i = highlightsGroup.children.length - 1; i >= 0; i--) {
    const c = highlightsGroup.children[i];
    c.geometry.dispose();
    highlightsGroup.remove(c);
  }
}

const dotGeo = new THREE.CircleGeometry(0.15, 24);
const ringGeo = new THREE.TorusGeometry(0.42, 0.045, 10, 28);
const dotMat = new THREE.MeshBasicMaterial({ color: COLORS.highlight, transparent: true, opacity: 0.85, depthWrite: false });
const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.capture, transparent: true, opacity: 0.9, depthWrite: false });

function buildHighlights() {
  clearHighlights();
  for (const m of legalForSelected) {
    const { x, z } = squareToWorld(m.to);
    const isCapture = !!engine.get(m.to) || !!(m.flags & BITS.EP);
    if (isCapture) {
      const ring = new THREE.Mesh(ringGeo.clone(), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.02, z);
      highlightsGroup.add(ring);
    } else {
      const dot = new THREE.Mesh(dotGeo.clone(), dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(x, 0.02, z);
      highlightsGroup.add(dot);
    }
  }
}

// ---------------------------------------------------------------- moves + animation
function doMove(move) {
  busy = true;
  performMove(move, onMoveComplete);
}

function performMove(move, onDone) {
  const fromSq = move.from, toSq = move.to;
  const movingPiece = engine.get(fromSq);
  const moverColor = movingPiece.color;
  const moverType = movingPiece.type;

  // capture square
  let capturedSq = -1;
  if (move.flags & BITS.EP) capturedSq = moverColor === WHITE ? toSq - 16 : toSq + 16;
  else if (pieceMeshes.has(toSq)) capturedSq = toSq;

  // castling rook
  let rookFrom = -1, rookTo = -1;
  if (move.flags & BITS.KSIDE) { rookFrom = moverColor === WHITE ? 7 : 119; rookTo = moverColor === WHITE ? 5 : 117; }
  else if (move.flags & BITS.QSIDE) { rookFrom = moverColor === WHITE ? 0 : 112; rookTo = moverColor === WHITE ? 3 : 115; }

  const isPromo = !!(move.flags & BITS.PROMOTION);
  const moverGroup = pieceMeshes.get(fromSq);
  const capturedGroup = capturedSq >= 0 ? pieceMeshes.get(capturedSq) : null;
  const rookGroup = rookFrom >= 0 ? pieceMeshes.get(rookFrom) : null;

  // advance the rules engine
  engine.makeMove(move);

  // update the visual board map
  pieceMeshes.delete(fromSq);
  if (capturedGroup) pieceMeshes.delete(capturedSq);
  if (rookGroup) { pieceMeshes.delete(rookFrom); pieceMeshes.set(rookTo, rookGroup); }

  const didCapture = !!capturedGroup;
  let anims = 0;
  const finish = () => { if (--anims === 0) onDone(didCapture); };

  // animate captured piece out
  if (capturedGroup) {
    anims++;
    addTween(0.28, easeInCubic, (t) => {
      const s = 1 - t;
      capturedGroup.scale.setScalar(Math.max(0.001, s));
      capturedGroup.position.y = -0.4 * t;
    }, () => { disposeGroup(capturedGroup); finish(); });
  }

  // animate rook for castling
  if (rookGroup) {
    anims++;
    const a = { x: rookGroup.position.x, z: rookGroup.position.z };
    const b = squareToWorld(rookTo);
    addTween(0.34, easeInOutCubic, (t) => {
      rookGroup.position.x = a.x + (b.x - a.x) * t;
      rookGroup.position.z = a.z + (b.z - a.z) * t;
      rookGroup.position.y = 0.12 * Math.sin(Math.PI * t);
    }, finish);
  }

  // animate the mover
  anims++;
  const a = { x: moverGroup.position.x, z: moverGroup.position.z };
  const b = squareToWorld(toSq);
  const lift = moverType === 'n' ? 0.55 : 0.16;
  addTween(0.34, easeInOutCubic, (t) => {
    moverGroup.position.x = a.x + (b.x - a.x) * t;
    moverGroup.position.z = a.z + (b.z - a.z) * t;
    moverGroup.position.y = lift * Math.sin(Math.PI * t);
  }, () => {
    moverGroup.position.set(b.x, 0, b.z);
    if (isPromo) {
      disposeGroup(moverGroup);
      const ng = createPieceMesh(move.promotion, MAT[moverColor === WHITE ? 'white' : 'black']);
      ng.position.set(b.x, 0, b.z);
      orientPiece(ng, moverColor);
      ng.userData = { square: toSq, color: moverColor, type: move.promotion };
      piecesGroup.add(ng);
      pieceMeshes.set(toSq, ng);
    } else {
      moverGroup.userData.square = toSq;
      pieceMeshes.set(toSq, moverGroup);
    }
    finish();
  });

  if (anims === 0) onDone(didCapture);
}

function onMoveComplete(didCapture) {
  updateCheckMarker();
  if (soundOn) {
    if (engine.isCheckmate()) playTone(660, 0.18, 'sine', 0.3);
    else if (engine.inCheck()) { playTone(720, 0.09, 'sine', 0.22); setTimeout(() => playTone(560, 0.12, 'sine', 0.2), 90); }
    else if (didCapture) playCapture();
    else playMove();
  }

  if (engine.isGameOver()) { showGameOver(); updateStatus(); return; }

  updateStatus();

  if (mode === 'ai' && engine.turn !== humanColor) {
    runAI();
  } else {
    busy = false;
  }
}

function runAI() {
  busy = true;
  $('thinking').classList.add('show');
  // let the UI paint the spinner before the (synchronous) search
  setTimeout(() => {
    let move = null;
    try { move = pickMove(engine, level); } catch (e) { console.error(e); }
    $('thinking').classList.remove('show');
    if (!move) { busy = false; return; }
    performMove(move, onMoveComplete);
  }, 90);
}

function isHumanTurn() {
  if (gameOver) return false;
  if (mode === '2p') return true;
  return engine.turn === humanColor;
}

function updateCheckMarker() {
  if (!gameOver && engine.inCheck()) {
    const ksq = engine.kings[engine.turn];
    const { x, z } = squareToWorld(ksq);
    checkMarker.position.set(x, 0.013, z);
    checkMarker.visible = true;
  } else {
    checkMarker.visible = false;
  }
}

// ---------------------------------------------------------------- promotion UI
let promoMoves = null;
function askPromotion(moves) {
  promoMoves = moves;
  busy = true;
  $('promo').classList.add('show');
}
function choosePromotion(type) {
  $('promo').classList.remove('show');
  const m = promoMoves ? promoMoves.find((x) => x.promotion === type) : null;
  promoMoves = null;
  deselect();
  if (m) doMove(m); else busy = false;
}

// ---------------------------------------------------------------- status + modal
const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function materialEdge() {
  let w = 0, b = 0;
  for (const p of engine.pieces()) {
    if (p.color === WHITE) w += PIECE_VAL[p.type]; else b += PIECE_VAL[p.type];
  }
  return w - b;
}

function updateStatus() {
  const main = $('status-main');
  const sub = $('status-sub');
  const dot = $('turn-dot');

  const turnName = engine.turn === WHITE ? 'Putih' : 'Hitam';
  dot.style.background = engine.turn === WHITE ? '#efe6d0' : '#22222a';
  dot.style.boxShadow = engine.turn === WHITE ? '0 0 0 1px rgba(0,0,0,.35) inset' : '0 0 0 1px rgba(255,255,255,.25) inset';

  if (gameOver) {
    main.textContent = $('modal-title').textContent || 'Permainan selesai';
  } else if (mode === 'ai' && engine.turn !== humanColor) {
    main.textContent = 'Giliran Komputer';
  } else {
    main.textContent = 'Giliran ' + turnName;
  }

  const bits = [];
  if (!gameOver && engine.inCheck()) bits.push('Skak!');
  const edge = materialEdge();
  if (edge !== 0) bits.push((edge > 0 ? 'Putih' : 'Hitam') + ' +' + Math.abs(edge));
  sub.textContent = bits.join('  •  ');
}

function showGameOver() {
  gameOver = true;
  busy = false;
  let title = 'Remis', text = '';
  if (engine.isCheckmate()) {
    const winner = engine.turn === WHITE ? 'Hitam' : 'Putih';
    title = 'Skakmat!';
    let who = winner;
    if (mode === 'ai') who = (engine.turn !== humanColor) ? 'Kamu' : 'Komputer';
    text = `${winner} menang. ${who} unggul di papan.`;
  } else if (engine.isStalemate()) {
    title = 'Remis'; text = 'Posisi buntu (stalemate) — tidak ada langkah sah.';
  } else if (engine.isThreefold()) {
    title = 'Remis'; text = 'Pengulangan posisi tiga kali.';
  } else if (engine.isFiftyMove()) {
    title = 'Remis'; text = 'Aturan 50 langkah tanpa tangkapan atau gerak pion.';
  } else if (engine.isInsufficientMaterial()) {
    title = 'Remis'; text = 'Materi tidak cukup untuk skakmat.';
  }
  $('modal-title').textContent = title;
  $('modal-text').textContent = text;
  $('modal').classList.add('show');
}

// ---------------------------------------------------------------- new game / undo / flip
function newGame() {
  engine.reset();
  gameOver = false;
  busy = false;
  deselect();
  checkMarker.visible = false;
  $('modal').classList.remove('show');
  spawnPieces();
  updateStatus();
  setCameraToSide(humanColor, false);
  if (mode === 'ai' && engine.turn !== humanColor) runAI();
}

function undo() {
  if (busy) return;
  if (engine.history.length === 0) return;
  // In AI mode, undo a full pair so it stays the human's turn.
  engine.undo();
  if (mode === 'ai' && engine.history.length > 0 && engine.turn !== humanColor) engine.undo();
  gameOver = false;
  $('modal').classList.remove('show');
  deselect();
  spawnPieces();
  updateCheckMarker();
  updateStatus();
}

function flipView() {
  // orbit to the opposite side, reflecting the camera through the target (xz)
  const t = controls.target;
  const target = new THREE.Vector3(2 * t.x - camera.position.x, camera.position.y, 2 * t.z - camera.position.z);
  tweenCamera(target);
}

// ---------------------------------------------------------------- tween helpers
function addTween(dur, ease, update, done) {
  tweens.push({ dur, ease, update, done, t: 0 });
}
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

let camTween = null;
function tweenCamera(targetPos) {
  camTween = { from: camera.position.clone(), to: targetPos.clone(), t: 0, dur: 0.6 };
}

function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const tn = Math.min(tw.t / tw.dur, 1);
    tw.update(tw.ease(tn));
    if (tn >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); }
  }
  if (camTween) {
    camTween.t += dt;
    const tn = Math.min(camTween.t / camTween.dur, 1);
    const e = easeInOutCubic(tn);
    camera.position.lerpVectors(camTween.from, camTween.to, e);
    if (tn >= 1) camTween = null;
  }
}

// ---------------------------------------------------------------- sound (WebAudio)
let actx = null;
function ensureAudio() {
  if (actx || !soundOn) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { actx = null; }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
function playTone(freq, dur, type = 'sine', gain = 0.2) {
  if (!actx || !soundOn) return;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, actx.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination);
  o.start(); o.stop(actx.currentTime + dur + 0.02);
}
function playMove() { playTone(300, 0.08, 'triangle', 0.16); }
function playCapture() {
  playTone(170, 0.12, 'sawtooth', 0.18);
  setTimeout(() => playTone(120, 0.1, 'triangle', 0.14), 40);
}

// ---------------------------------------------------------------- render loop
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateTweens(dt);
  // gentle pulse for highlights
  const p = 0.6 + 0.4 * Math.sin(performance.now() * 0.005);
  dotMat.opacity = 0.55 + 0.3 * p;
  ringMat.opacity = 0.6 + 0.3 * p;
  if (controls) controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  const stage = $('stage');
  camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  // keep the user's angle, just refit the distance
  const offset = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  const aspect = camera.aspect;
  sph.radius = Math.min(Math.max(9 / Math.sqrt(Math.min(aspect, 1)), 9), 14.5);
  offset.setFromSpherical(sph);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

// ---------------------------------------------------------------- UI wiring
function wireUI() {
  $('btn-new').addEventListener('click', newGame);
  $('btn-undo').addEventListener('click', undo);
  $('btn-flip').addEventListener('click', flipView);
  $('btn-settings').addEventListener('click', () => $('settings').classList.add('show'));
  $('settings-done').addEventListener('click', () => $('settings').classList.remove('show'));
  $('modal-new').addEventListener('click', newGame);

  document.querySelectorAll('#promo .promo-btn').forEach((b) => {
    b.addEventListener('click', () => choosePromotion(b.dataset.type));
  });

  // segmented controls
  setupSegment('seg-mode', (v) => { mode = v; updateModeUI(); newGame(); });
  setupSegment('seg-level', (v) => { level = v; });
  setupSegment('seg-color', (v) => { humanColor = v === 'w' ? WHITE : BLACK; newGame(); });
  $('toggle-sound').addEventListener('change', (e) => { soundOn = e.target.checked; if (soundOn) ensureAudio(); });

  updateModeUI();
}

function setupSegment(id, onChange) {
  const seg = $(id);
  seg.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.value);
    });
  });
}

function updateModeUI() {
  // color + level only matter against the computer
  $('row-color').style.display = mode === 'ai' ? '' : 'none';
  $('row-level').style.display = mode === 'ai' ? '' : 'none';
}

// ---------------------------------------------------------------- boot
function boot() {
  try {
    setup();
    wireUI();
    spawnPieces();
    updateStatus();
    if (mode === 'ai' && engine.turn !== humanColor) runAI();
  } catch (err) {
    console.error(err);
    const e = $('error');
    if (e) { e.style.display = 'flex'; $('error-msg').textContent = String(err && err.message || err); }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
