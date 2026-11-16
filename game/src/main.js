// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=start|play|site|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady. ?auto=1 runs an autopilot that plays the game
// on its own, for smoke-testing in a headless browser.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp } from './rng.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createSim } from './sim.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const auto = params.get('auto') === '1';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed);

window.__errors = [];
window.addEventListener('error', (event) => {
  window.__errors.push(String(event.message || event.error));
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2019');
scene.fog = new THREE.Fog(new THREE.Color('#2a2019'), 24, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const mapData = createMap(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(mapData.colliders);
const weapons = createWeapons(camera);
const input = createInput(renderer.domElement, onLockChange);
const hooks = {};
const bots = createBots(scene, mapData.colliders, mapData.shootables, rng, hooks);
const sim = createSim({
  scene, camera, player, weapons, bots, mapData, hud, audio, input, rng, hooks,
});

const body = player.state;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let autoBought = false;
const _v = new THREE.Vector3();

hud.setAmmo(weapons.state.owned.pistol.mag, weapons.state.owned.pistol.reserve, 'P9 Sidearm');
hud.setMoney(800);
hud.setHealth(100, 0);
hud.setScore(0, 0, 1);
hud.setTimer(100, false);
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (sim.state.phase === 'lobby' || sim.state.phase === 'matchEnd') sim.startMatch();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot || auto) return;
  if (locked) {
    hud.hideOverlay();
  } else if ((sim.state.phase === 'live' || sim.state.phase === 'buy') && sim.state.playerAlive) {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  if (!sim.state.playerAlive && sim.state.spectate) {
    const bot = sim.state.spectate;
    camera.position.set(bot.mover.position.x, 1.55, bot.mover.position.z);
    camera.rotation.set(-0.06, bot.yaw, 0, 'YXZ');
    return;
  }
  const shake = sim.state.shake;
  const shX = shake > 0 ? (rng() * 2 - 1) * shake * 0.02 : 0;
  const shY = shake > 0 ? (rng() * 2 - 1) * shake * 0.02 : 0;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch + shX, body.yaw + shY, 0, 'YXZ');
  const zoomTarget = input.state.aiming && sim.state.playerAlive ? 74 / weapons.currentDef().zoom : 74;
  if (Math.abs(camera.fov - zoomTarget) > 0.1) {
    camera.fov += (zoomTarget - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function aimAt(x, y, z) {
  const dx = x - body.position.x;
  const dy = y - (body.position.y + body.eye);
  const dz = z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(clamp(dy / length, -1, 1));
  syncCamera();
}

function step(dt) {
  sim.step(dt, input.state.keys);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (auto) autopilot(dt);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function autopilot(dt) {
  // Plays the game on its own: buys a rifle, walks at the nearest Ash bot,
  // plants when it reaches a site carrying the charge.
  const s = sim.state;
  if (s.phase === 'lobby') {
    sim.startMatch();
    return;
  }
  if (s.phase === 'buy' && !autoBought) {
    autoBought = true;
    sim.buy('2');
    sim.buy('6');
    return;
  }
  if (s.phase !== 'live' || !s.playerAlive) return;
  const enemies = bots.aliveOf('ash');
  if (!enemies.length) return;
  let nearest = null;
  let nearestD = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.mover.position.x - body.position.x, e.mover.position.z - body.position.z);
    if (d < nearestD) { nearestD = d; nearest = e; }
  }
  if (!nearest) return;
  const dx = nearest.mover.position.x - body.position.x;
  const dz = nearest.mover.position.z - body.position.z;
  const wantYaw = Math.atan2(-dx, -dz);
  let dy = wantYaw - body.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  body.yaw += clamp(dy, -dt * 3, dt * 3);
  body.pitch += (Math.asin(clamp((1.15 - body.eye) / Math.max(1, nearestD), -1, 1)) - body.pitch) * Math.min(1, dt * 4);
  const keys = input.state.keys;
  keys.clear();
  if (nearestD > 9) keys.add('KeyW');
  if (Math.abs(dy) < 0.06) input.state.firing = true;
  else input.state.firing = false;
  if (s.bomb.state === 'carried' && s.bomb.carrier === 'player') {
    const siteA = Math.hypot(body.position.x + 15, body.position.z + 12) < 4;
    const siteB = Math.hypot(body.position.x - 15, body.position.z + 12) < 4;
    if (siteA || siteB) keys.add('KeyE');
  }
}

function settle(seconds) {
  const steps = Math.round(seconds / FIXED_STEP);
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function visibleEnemy() {
  // The first living Ash bot with a clear line of sight from the camera.
  const eye = new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z);
  const ray = new THREE.Raycaster();
  const target = new THREE.Vector3();
  for (const bot of bots.aliveOf('ash')) {
    target.set(bot.mover.position.x, 1.15, bot.mover.position.z);
    const dir = target.clone().sub(eye);
    const dist = dir.length();
    ray.set(eye, dir.normalize());
    ray.far = dist;
    if (!ray.intersectObjects(mapData.shootables, false)[0]) return bot;
  }
  return bots.aliveOf('ash')[0] || null;
}

function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    body.position.set(0, 0, 14);
    body.yaw = 0;
    body.pitch = 0.03;
    settle(0.5);
    hud.showOverlay('start');
    paintTwiceThenReady();
    return;
  }
  sim.startMatch();
  // Skip the buy phase: the capture is of live play.
  sim.state.phase = 'live';
  sim.state.timer = 96;
  hud.setBuyOpen(false, [], sim.state.money);
  if (name === 'play') {
    // Behind the mid crates, a short firefight: settle just long enough for
    // the Ash bots to take their holds, then aim and fire before they can
    // chew through a stationary player.
    body.position.set(-2, 0, 4.5);
    body.yaw = 0.1;
    settle(3);
    const target = visibleEnemy();
    if (target) {
      // Re-aim before every shot: the bots keep walking between rounds.
      for (let i = 0; i < 3; i += 1) {
        aimAt(target.mover.position.x, 1.15, target.mover.position.z);
        sim.shoot();
        settle(0.2);
      }
      aimAt(target.mover.position.x, 1.15, target.mover.position.z);
      sim.shoot();
    }
    // Freeze at once: the last tracer is still in the air for the capture.
    paintTwiceThenReady();
    return;
  }
  if (name === 'site') {
    // Behind the low wall on the A approach, charge planted at Furnace.
    body.position.set(-8, 0, 7.5);
    body.yaw = 0.35;
    settle(2);
    sim.state.bomb.state = 'planted';
    sim.state.bomb.site = 'A';
    sim.state.bomb.fuse = 31;
    sim.state.bomb.pos.set(-15, 0.2, -12);
    settle(0.3); // let one sim step refresh the HUD bomb banner and timer
    const target = visibleEnemy();
    if (target) {
      aimAt(target.mover.position.x, 1.15, target.mover.position.z);
      sim.shoot();
    }
    paintTwiceThenReady();
    return;
  }
  // end: wipe the Ash team and let the round banner show.
  for (const bot of bots.aliveOf('ash')) {
    bots.applyDamage(bot, 9999, 'body', { name: 'You', team: 'ember' });
  }
  settle(1.2);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = { sim, bots, player, weapons };
syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
