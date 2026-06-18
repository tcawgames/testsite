// ===================== BLOCKCRAFT =====================
// Single-file voxel sandbox. Three.js r128.

(function () {
'use strict';

// ---------- CONSTANTS ----------
const CHUNK_SIZE = 16;
const WORLD_HEIGHT = 48;
const RENDER_DISTANCE = 3; // chunks radius
const GRAVITY = -28;
const JUMP_VELOCITY = 9.2;
const WALK_SPEED = 5.2;
const FLY_SPEED = 9;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.3;
const REACH = 6;

const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD: 5, LEAVES: 6,
  WATER: 7, PLANK: 8, BRICK: 9, SNOW: 10, COAL_ORE: 11, GOLD_ORE: 12
};

const BLOCK_COLORS = {
  [BLOCK.GRASS]:   { top: 0x6cbf4a, side: 0x8a6b45, bottom: 0x6b4a32 },
  [BLOCK.DIRT]:    { all: 0x8a6b45 },
  [BLOCK.STONE]:   { all: 0x8a8a8a },
  [BLOCK.SAND]:    { all: 0xe0d49a },
  [BLOCK.WOOD]:    { top: 0x9c7b4f, side: 0x6f5430, bottom: 0x9c7b4f },
  [BLOCK.LEAVES]:  { all: 0x4f9c3a },
  [BLOCK.WATER]:   { all: 0x3a6fd6 },
  [BLOCK.PLANK]:   { all: 0xc7a06b },
  [BLOCK.BRICK]:   { all: 0xa85a3f },
  [BLOCK.SNOW]:    { all: 0xf2f8fc },
  [BLOCK.COAL_ORE]:{ all: 0x4a4a4a },
  [BLOCK.GOLD_ORE]:{ all: 0xd9b94a },
};

const HOTBAR_BLOCKS = [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD, BLOCK.PLANK, BLOCK.BRICK, BLOCK.SAND, BLOCK.LEAVES, BLOCK.SNOW];
const BLOCK_NAMES = {
  [BLOCK.GRASS]: 'Grass', [BLOCK.DIRT]: 'Dirt', [BLOCK.STONE]: 'Stone', [BLOCK.SAND]: 'Sand',
  [BLOCK.WOOD]: 'Log', [BLOCK.LEAVES]: 'Leaves', [BLOCK.PLANK]: 'Planks', [BLOCK.BRICK]: 'Brick',
  [BLOCK.SNOW]: 'Snow', [BLOCK.COAL_ORE]: 'Coal Ore', [BLOCK.GOLD_ORE]: 'Gold Ore'
};

// ---------- SIMPLE VALUE NOISE ----------
function makeNoise(seed) {
  let s = seed;
  function rand2(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7 + s * 1000.0) * 43758.5453123;
    return n - Math.floor(n);
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = rand2(xi, yi), b = rand2(xi + 1, yi);
    const c = rand2(xi, yi + 1), d = rand2(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function fbm(x, y, octaves = 4, lac = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, y * freq) * amp;
      maxAmp += amp;
      amp *= gain;
      freq *= lac;
    }
    return sum / maxAmp;
  };
}

// ---------- GAME STATE ----------
const state = {
  seed: Math.floor(Math.random() * 100000),
  chunks: new Map(), // key "cx,cz" -> { blocks: Uint8Array, mesh, dirty }
  player: {
    pos: new THREE.Vector3(8, 40, 8),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    onGround: false,
    flying: false,
  },
  selectedSlot: 0,
  paused: true,
  started: false,
  isTouch: false,
  keys: {},
  lastTime: performance.now(),
  fpsAccum: 0, fpsFrames: 0, fpsDisplay: 0,
};

let noiseHeight, noiseDetail, noiseTree;

function initNoise() {
  noiseHeight = makeNoise(state.seed);
  noiseDetail = makeNoise(state.seed + 1337);
  noiseTree = makeNoise(state.seed + 9001);
}

function getColumnHeight(wx, wz) {
  const base = noiseHeight(wx * 0.018, wz * 0.018, 4, 2.0, 0.5);
  const detail = noiseDetail(wx * 0.07, wz * 0.07, 2, 2.0, 0.5);
  let h = 18 + base * 14 + detail * 3;
  return Math.max(4, Math.min(WORLD_HEIGHT - 6, Math.round(h)));
}

function biomeAt(wx, wz) {
  const m = noiseDetail(wx * 0.01 + 500, wz * 0.01 + 500, 3, 2.0, 0.5);
  if (m < -0.15) return 'desert';
  if (m > 0.25) return 'snow';
  return 'plains';
}

// ---------- CHUNK DATA ----------
function chunkKey(cx, cz) { return cx + ',' + cz; }

function idx(x, y, z) {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

function generateChunkData(cx, cz) {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      const h = getColumnHeight(wx, wz);
      const biome = biomeAt(wx, wz);
      for (let y = 0; y <= h; y++) {
        let b;
        if (y === h) {
          b = biome === 'desert' ? BLOCK.SAND : biome === 'snow' ? BLOCK.SNOW : BLOCK.GRASS;
        } else if (y > h - 4) {
          b = biome === 'desert' ? BLOCK.SAND : BLOCK.DIRT;
        } else {
          b = BLOCK.STONE;
          // sparse ore
          const oreN = noiseDetail(wx * 0.3 + 99, (y * 1.7) + wz * 0.3, 1, 2, 0.5);
          if (oreN > 0.42 && y < h - 6) b = BLOCK.COAL_ORE;
          else if (oreN < -0.46 && y < h - 10) b = BLOCK.GOLD_ORE;
        }
        blocks[idx(lx, y, lz)] = b;
      }
      // water fill for low areas
      if (h < 16) {
        for (let y = h + 1; y <= 16; y++) blocks[idx(lx, y, lz)] = BLOCK.WATER;
      }
      // trees
      if (biome === 'plains' && h >= 16) {
        const t = noiseTree(wx * 0.5, wz * 0.5, 1, 2, 0.5);
        const tHash = Math.abs(Math.sin(wx * 12.9898 + wz * 78.233 + state.seed) * 43758.5453) % 1;
        if (t > 0.55 && tHash > 0.92) {
          const trunkH = 4 + (tHash > 0.96 ? 1 : 0);
          for (let ty = 1; ty <= trunkH; ty++) {
            if (h + ty < WORLD_HEIGHT) blocks[idx(lx, h + ty, lz)] = BLOCK.WOOD;
          }
          // leaves canopy stored in a separate pass below (needs neighbor chunk awareness skip - simple local only)
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
                const lx2 = lx + dx, lz2 = lz + dz, ly2 = h + trunkH + dy;
                if (lx2 >= 0 && lx2 < CHUNK_SIZE && lz2 >= 0 && lz2 < CHUNK_SIZE && ly2 < WORLD_HEIGHT) {
                  if (blocks[idx(lx2, ly2, lz2)] === BLOCK.AIR) blocks[idx(lx2, ly2, lz2)] = BLOCK.LEAVES;
                }
              }
            }
          }
          for (let i = 0; i < 2; i++) {
            const ly2 = h + trunkH + 1 + i;
            if (ly2 < WORLD_HEIGHT && blocks[idx(lx, ly2, lz)] === BLOCK.AIR) blocks[idx(lx, ly2, lz)] = BLOCK.LEAVES;
          }
        }
      }
    }
  }
  return blocks;
}

function getChunk(cx, cz, createIfMissing = true) {
  const key = chunkKey(cx, cz);
  let c = state.chunks.get(key);
  if (!c && createIfMissing) {
    c = { blocks: generateChunkData(cx, cz), mesh: null, dirty: true, cx, cz };
    state.chunks.set(key, c);
  }
  return c;
}

function worldToChunkCoords(wx, wy, wz) {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const lx = wx - cx * CHUNK_SIZE;
  const lz = wz - cz * CHUNK_SIZE;
  return { cx, cz, lx, ly: wy, lz };
}

function getBlock(wx, wy, wz) {
  if (wy < 0 || wy >= WORLD_HEIGHT) return BLOCK.AIR;
  const { cx, cz, lx, ly, lz } = worldToChunkCoords(Math.floor(wx), Math.floor(wy), Math.floor(wz));
  const c = getChunk(cx, cz, false);
  if (!c) return BLOCK.AIR; // ungenerated treated as air for now (won't normally be queried)
  return c.blocks[idx(lx, ly, lz)];
}

function setBlock(wx, wy, wz, block) {
  if (wy < 0 || wy >= WORLD_HEIGHT) return;
  const { cx, cz, lx, ly, lz } = worldToChunkCoords(Math.floor(wx), Math.floor(wy), Math.floor(wz));
  const c = getChunk(cx, cz, true);
  c.blocks[idx(lx, ly, lz)] = block;
  c.dirty = true;
  // mark neighbor chunks dirty if on boundary (for seamless faces)
  if (lx === 0) markDirty(cx - 1, cz);
  if (lx === CHUNK_SIZE - 1) markDirty(cx + 1, cz);
  if (lz === 0) markDirty(cx, cz - 1);
  if (lz === CHUNK_SIZE - 1) markDirty(cx, cz + 1);
}

function markDirty(cx, cz) {
  const c = state.chunks.get(chunkKey(cx, cz));
  if (c) c.dirty = true;
}

function isSolid(block) {
  return block !== BLOCK.AIR && block !== BLOCK.WATER;
}

// ---------- THREE.JS SETUP ----------
let scene, camera, renderer, raycastHelper;
let sunLight, ambientLight;
let highlightMesh;

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ed1f0);
  scene.fog = new THREE.Fog(0x9ed1f0, 60, 140);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.zIndex = '0';

  ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);
  sunLight = new THREE.DirectionalLight(0xfff4d6, 0.85);
  sunLight.position.set(60, 100, 40);
  scene.add(sunLight);

  const highlightGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, transparent: true, opacity: 0.6 });
  highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
  highlightMesh.visible = false;
  scene.add(highlightMesh);

  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------- CHUNK MESHING ----------
// Face definitions: direction, vertex offsets (CCW), normal
const FACES = [
  { dir: [1, 0, 0], normal: [1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },   // +X
  { dir: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] }, // -X
  { dir: [0, 1, 0], normal: [0, 1, 0], corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },   // +Y
  { dir: [0, -1, 0], normal: [0, -1, 0], corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] }, // -Y
  { dir: [0, 0, 1], normal: [0, 0, 1], corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },   // +Z
  { dir: [0, 0, -1], normal: [0, 0, -1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }, // -Z
];

function colorForFace(block, faceIndex) {
  const def = BLOCK_COLORS[block];
  if (!def) return 0xff00ff;
  if (def.all !== undefined) return def.all;
  if (faceIndex === 2) return def.top;
  if (faceIndex === 3) return def.bottom;
  return def.side;
}

function buildChunkMesh(chunk) {
  // dispose old
  if (chunk.mesh) {
    scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.dispose();
    chunk.mesh = null;
  }
  if (chunk.waterMesh) {
    scene.remove(chunk.waterMesh);
    chunk.waterMesh.geometry.dispose();
    chunk.waterMesh.material.dispose();
    chunk.waterMesh = null;
  }

  const positions = [], normals = [], colors = [];
  const wPositions = [], wNormals = [], wColors = [];

  function neighborBlock(lx, ly, lz, dx, dy, dz) {
    const nx = lx + dx, ny = ly + dy, nz = lz + dz;
    if (nx >= 0 && nx < CHUNK_SIZE && ny >= 0 && ny < WORLD_HEIGHT && nz >= 0 && nz < CHUNK_SIZE) {
      return chunk.blocks[idx(nx, ny, nz)];
    }
    // query world (neighbor chunk) — may trigger generation, that's fine since adjacent chunks should exist within render distance
    return getBlock(chunk.cx * CHUNK_SIZE + nx, ny, chunk.cz * CHUNK_SIZE + nz);
  }

  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let ly = 0; ly < WORLD_HEIGHT; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const block = chunk.blocks[idx(lx, ly, lz)];
        if (block === BLOCK.AIR) continue;
        const water = block === BLOCK.WATER;
        for (let f = 0; f < FACES.length; f++) {
          const face = FACES[f];
          const nb = neighborBlock(lx, ly, lz, face.dir[0], face.dir[1], face.dir[2]);
          // Skip drawing a face when the neighbor fully occludes it:
          // - solid blocks are occluded only by other solid blocks
          // - water faces are occluded by solid blocks AND by other water (no internal water faces)
          if (!water && isSolid(nb)) continue;
          if (water && (isSolid(nb) || nb === BLOCK.WATER)) continue;

          const col = colorForFace(block, f) || 0xff00ff;
          const r = ((col >> 16) & 255) / 255, g = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
          // simple ambient occlusion-ish shading by face direction
          let shade = 1.0;
          if (f === 2) shade = 1.0;       // top
          else if (f === 3) shade = 0.6;  // bottom
          else if (f === 0 || f === 1) shade = 0.82;
          else shade = 0.72;

          const targetPos = water ? wPositions : positions;
          const targetNorm = water ? wNormals : normals;
          const targetCol = water ? wColors : colors;

          const c0 = face.corners[0], c1 = face.corners[1], c2 = face.corners[2], c3 = face.corners[3];
          const verts = [c0, c1, c2, c0, c2, c3];
          for (const v of verts) {
            targetPos.push(lx + v[0], ly + v[1], lz + v[2]);
            targetNorm.push(face.normal[0], face.normal[1], face.normal[2]);
            targetCol.push(r * shade, g * shade, b * shade);
          }
        }
      }
    }
  }

  function makeMesh(posArr, normArr, colArr, isWater) {
    if (posArr.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: isWater,
      opacity: isWater ? 0.75 : 1.0,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    return mesh;
  }

  chunk.mesh = makeMesh(positions, normals, colors, false);
  if (chunk.mesh) scene.add(chunk.mesh);
  chunk.waterMesh = makeMesh(wPositions, wNormals, wColors, true);
  if (chunk.waterMesh) scene.add(chunk.waterMesh);

  chunk.dirty = false;
}

// ---------- WORLD STREAMING ----------
function updateChunks() {
  const px = state.player.pos.x, pz = state.player.pos.z;
  const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);

  // ensure needed chunks exist + build dirty ones (limit builds per frame)
  let builds = 0;
  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      const cx = pcx + dx, cz = pcz + dz;
      const c = getChunk(cx, cz, true);
      if (c.dirty && builds < 2) {
        buildChunkMesh(c);
        builds++;
      }
    }
  }

  // unload far chunks
  const toRemove = [];
  state.chunks.forEach((c, key) => {
    const ddx = c.cx - pcx, ddz = c.cz - pcz;
    if (Math.abs(ddx) > RENDER_DISTANCE + 1 || Math.abs(ddz) > RENDER_DISTANCE + 1) {
      toRemove.push(key);
    }
  });
  for (const key of toRemove) {
    const c = state.chunks.get(key);
    if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.material.dispose(); }
    if (c.waterMesh) { scene.remove(c.waterMesh); c.waterMesh.geometry.dispose(); c.waterMesh.material.dispose(); }
    state.chunks.delete(key);
  }
}

// ---------- RAYCAST (DDA voxel traversal) ----------
function raycastBlock(origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;

  function tDelta(d) { return d === 0 ? Infinity : Math.abs(1 / d); }
  function tMax(o, d, step) {
    if (d === 0) return Infinity;
    const boundary = step > 0 ? Math.floor(o) + 1 : Math.floor(o);
    return (boundary - o) / d;
  }

  const tDeltaX = tDelta(dir.x), tDeltaY = tDelta(dir.y), tDeltaZ = tDelta(dir.z);
  let tMaxX = tMax(origin.x, dir.x, stepX);
  let tMaxY = tMax(origin.y, dir.y, stepY);
  let tMaxZ = tMax(origin.z, dir.z, stepZ);

  let dist = 0;
  let lastNormal = [0, 0, 0];

  while (dist < maxDist) {
    const block = getBlock(x, y, z);
    if (isSolid(block)) {
      return { x, y, z, normal: lastNormal, block };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; dist = tMaxX; tMaxX += tDeltaX; lastNormal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; dist = tMaxY; tMaxY += tDeltaY; lastNormal = [0, -stepY, 0];
    } else {
      z += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ; lastNormal = [0, 0, -stepZ];
    }
  }
  return null;
}

function getLookDirection() {
  const dir = new THREE.Vector3(0, 0, -1);
  dir.applyEuler(new THREE.Euler(state.player.pitch, state.player.yaw, 0, 'YXZ'));
  return dir;
}

function getEyePosition() {
  return new THREE.Vector3(state.player.pos.x, state.player.pos.y + PLAYER_HEIGHT * 0.9, state.player.pos.z);
}

// ---------- PHYSICS ----------
function aabbCollidesWorld(pos, halfW, height) {
  const minX = Math.floor(pos.x - halfW), maxX = Math.floor(pos.x + halfW);
  const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + height);
  const minZ = Math.floor(pos.z - halfW), maxZ = Math.floor(pos.z + halfW);
  for (let x = minX; x <= maxX; x++)
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        if (isSolid(getBlock(x, y, z))) return true;
  return false;
}

function movePlayer(dt) {
  const p = state.player;
  const speed = p.flying ? FLY_SPEED : WALK_SPEED;

  const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));

  let moveX = 0, moveZ = 0;
  const input = getMovementInput();
  moveX = input.x; moveZ = input.z;

  const wishDir = new THREE.Vector3();
  wishDir.addScaledVector(forward, moveZ);
  wishDir.addScaledVector(right, moveX);
  if (wishDir.lengthSq() > 0) wishDir.normalize();

  p.vel.x = wishDir.x * speed;
  p.vel.z = wishDir.z * speed;

  if (p.flying) {
    p.vel.y = input.y * speed;
  } else {
    p.vel.y += GRAVITY * dt;
    if (p.vel.y < -40) p.vel.y = -40;
  }

  // collide axis by axis
  const halfW = PLAYER_RADIUS;

  // X
  let newPos = p.pos.clone();
  newPos.x += p.vel.x * dt;
  if (!aabbCollidesWorld(newPos, halfW, PLAYER_HEIGHT)) p.pos.x = newPos.x;

  // Z
  newPos = p.pos.clone();
  newPos.z += p.vel.z * dt;
  if (!aabbCollidesWorld(newPos, halfW, PLAYER_HEIGHT)) p.pos.z = newPos.z;

  // Y
  newPos = p.pos.clone();
  newPos.y += p.vel.y * dt;
  p.onGround = false;
  if (!aabbCollidesWorld(newPos, halfW, PLAYER_HEIGHT)) {
    p.pos.y = newPos.y;
  } else {
    if (p.vel.y < 0) p.onGround = true;
    p.vel.y = 0;
  }

  // world bounds safety
  if (p.pos.y < -10) { p.pos.y = WORLD_HEIGHT + 5; p.vel.y = 0; }
}

function tryJump() {
  const p = state.player;
  if (p.flying) return;
  if (p.onGround) {
    p.vel.y = JUMP_VELOCITY;
    p.onGround = false;
  }
}

// ---------- INPUT: DESKTOP ----------
let pointerLocked = false;

function setupDesktopInput() {
  const canvas = renderer.domElement;

  canvas.addEventListener('click', () => {
    if (!state.isTouch && !pointerLocked && !state.paused) {
      canvas.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    const sensitivity = 0.0022;
    state.player.yaw -= e.movementX * sensitivity;
    state.player.pitch -= e.movementY * sensitivity;
    state.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.player.pitch));
  });

  window.addEventListener('keydown', (e) => {
    state.keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyF') {
      state.player.flying = !state.player.flying;
    }
    if (e.code === 'Escape') {
      togglePause(true);
    }
    const numMatch = e.code.match(/^Digit([1-9])$/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10) -
