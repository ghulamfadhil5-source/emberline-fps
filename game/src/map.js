// Foundry Yard: an original 46 x 38 m industrial yard at dusk. Two bomb sites —
// A "Furnace" in the north-west, B "Depot" in the north-east — joined by three
// lanes: A-long down the west wall, mid through the crate field, B-lane down the
// east wall. Every box is a collider for bodies and a surface bullets stop on.
// Waypoints form the graph bots walk; routes are ordered lists of node names.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#463b2e';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 26; i += 1) {
    g.beginPath();
    g.arc((i * 97) % 256, (i * 61) % 256, 6 + (i % 5) * 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,122,26,0.05)';
  g.fillRect(0, 120, 256, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 7);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWallTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#4b423a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 100, 128, 28);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, 0, 128, 4);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSignTexture(letter, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,14,10,0.92)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 116, 116);
  g.fillStyle = color;
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const WAYPOINTS = {
  emberSpawn: { x: 0, z: 15 },
  emberWest: { x: -8, z: 11 },
  emberEast: { x: 8, z: 11 },
  midSouth: { x: 0, z: 8 },
  midCrates: { x: 0, z: 0 },
  midNorth: { x: 0, z: -6 },
  aLongSouth: { x: -19, z: 8 },
  aLongMid: { x: -19, z: -2 },
  aLongNorth: { x: -19, z: -10 },
  aSite: { x: -15, z: -12 },
  aHold1: { x: -19, z: -15 },
  aHold2: { x: -11, z: -15 },
  bLaneSouth: { x: 19, z: 8 },
  bLaneMid: { x: 19, z: -2 },
  bLaneNorth: { x: 19, z: -10 },
  bSite: { x: 15, z: -12 },
  bHold1: { x: 19, z: -15 },
  bHold2: { x: 11, z: -15 },
  ashSpawn: { x: 0, z: -16 },
  midHold: { x: -2, z: -8 },
};

export const ROUTES = {
  toA: ['emberWest', 'aLongSouth', 'aLongMid', 'aLongNorth', 'aSite'],
  toB: ['emberEast', 'bLaneSouth', 'bLaneMid', 'bLaneNorth', 'bSite'],
  toMid: ['midSouth', 'midCrates', 'midNorth'],
  rotateA: ['aHold2', 'aSite'],
  rotateB: ['bHold2', 'bSite'],
  toAshA: ['ashSpawn', 'aHold2', 'aSite'],
  toAshB: ['ashSpawn', 'bHold2', 'bSite'],
};

export const SITES = {
  A: { x: -15, z: -12, radius: 4.5, label: 'FURNACE' },
  B: { x: 15, z: -12, radius: 4.5, label: 'DEPOT' },
};

export const SPAWNS = {
  ember: [
    { x: -5, z: 15.5, yaw: 0 },
    { x: -2, z: 16.5, yaw: 0 },
    { x: 1, z: 15.5, yaw: 0 },
    { x: 4, z: 16.5, yaw: 0 },
    { x: 7, z: 15.5, yaw: 0 },
  ],
  ash: [
    { x: -5, z: -16.5, yaw: Math.PI },
    { x: -2, z: -17.5, yaw: Math.PI },
    { x: 1, z: -16.5, yaw: Math.PI },
    { x: 4, z: -17.5, yaw: Math.PI },
    { x: 7, z: -16.5, yaw: Math.PI },
  ],
};

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const floorTex = makeFloorTexture();
  const wallTex = makeWallTexture();
  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0.05 }),
    crate: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.crate), roughness: 0.9, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metal), roughness: 0.55, metalness: 0.5 }),
    rust: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.8, metalness: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.85, metalness: 0.1 }),
  };

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground and perimeter.
  box(46.4, 0.4, 38.4, 0, -0.2, 0, 'floor');
  box(0.4, 5, 38.4, -23.2, 2.5, 0, 'wall');
  box(0.4, 5, 38.4, 23.2, 2.5, 0, 'wall');
  box(46.4, 5, 0.4, 0, 2.5, -19.2, 'wall');
  box(46.4, 5, 0.4, 0, 2.5, 19.2, 'wall');

  // Site A — the furnace: a rusted block with a tall chimney and an ember glow.
  box(5, 3.2, 3.5, -16, 1.6, -15.5, 'rust');
  box(1.4, 7, 1.4, -18.2, 3.5, -16.5, 'metal');
  box(5.4, 0.3, 3.9, -16, 3.35, -15.5, 'dark');
  const emberGlow = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.5, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  emberGlow.position.set(-16, 2.2, -13.7);
  group.add(emberGlow);

  // Site B — the depot: stacked containers.
  box(4.4, 2.6, 2.2, 17, 1.3, -16.8, 'metal');
  box(4.4, 2.6, 2.2, 17, 3.9, -16.8, 'rust');
  box(2.2, 2.6, 4.4, 11.5, 1.3, -16.5, 'crate');

  // Mid: a steel pillar splitting the lane, crates to crouch behind.
  box(1.4, 3.4, 1.4, 0, 1.7, -3, 'metal');
  box(2.2, 1.1, 1.2, -2, 0.55, 2, 'crate');
  box(1.2, 1.1, 2.2, 3, 0.55, 0, 'crate');
  box(1.6, 1.1, 1.6, -1, 0.55, -5.5, 'crate');
  box(2.4, 1.1, 1.2, 4.5, 0.55, -7, 'crate');

  // Lane cover.
  box(1.2, 1.1, 2.4, -15, 0.55, 4, 'crate');
  box(2.2, 1.1, 1.2, -17, 0.55, -6, 'crate');
  box(1.2, 1.1, 2.4, 15, 0.55, 4, 'crate');
  box(2.2, 1.1, 1.2, 17, 0.55, -6, 'crate');

  // Low walls: crouch cover on the approaches.
  box(6, 1.1, 0.6, -8, 0.55, 6, 'wall');
  box(6, 1.1, 0.6, 8, 0.55, 6, 'wall');
  box(0.6, 1.1, 6, -10, 0.55, -8, 'wall');
  box(0.6, 1.1, 6, 10, 0.55, -8, 'wall');

  // Spawn cover and a duct along the north wall.
  box(2, 1.1, 1.2, -4, 0.55, 14, 'crate');
  box(2, 1.1, 1.2, 4, 0.55, 14, 'crate');
  box(20, 0.8, 0.8, 0, 4.2, -18.4, 'metal');

  // Site signs and floor rings so a site reads from across the yard.
  function siteSign(letter, color, x, z) {
    const tex = makeSignTexture(letter, color);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    sign.position.set(x, 4.6, z + 3.4);
    group.add(sign);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.6, 4.2, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    group.add(ring);
  }
  siteSign('A', PALETTE.accent, -15, -12);
  siteSign('B', PALETTE.ash, 15, -12);

  // Dusk light: a low warm sun, cool sky fill, and a warm point at each site.
  const sky = new THREE.HemisphereLight(new THREE.Color('#a08a70'), new THREE.Color(PALETTE.canvas), 1.8);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 3.2);
  sun.position.set(18, 16, 14);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const siteA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 16, 1.6);
  siteA.position.set(-15, 3.2, -12);
  scene.add(siteA);
  const siteB = new THREE.PointLight(new THREE.Color(PALETTE.ash), 10, 16, 1.6);
  siteB.position.set(15, 3.2, -12);
  scene.add(siteB);

  return { colliders, shootables, group };
}
