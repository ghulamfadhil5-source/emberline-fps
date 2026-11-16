// Bots: nine AI fighters, four Ember teammates and five Ash defenders. Each bot
// has a route through the waypoint graph, a role, and a small state machine:
// MOVE along its route, HOLD a position and scan, ENGAGE a visible enemy in
// bursts with a human reaction delay, PLANT the charge, ROTATE to a planted
// site, or DEFUSE it. Vision is a real raycast against the map; hearing turns
// heads toward gunfire. One shared mover, one shared raycaster, no per-frame
// allocation in the hot path.
import * as THREE from 'three';
import { createMover } from './mover.js';
import { WAYPOINTS, ROUTES, SITES } from './map.js';
import { clamp, range, pick } from './rng.js';

const EYE = 1.5;
const BODY_Y = 1.15;
const WALK_SPEED = 3.9;
const ARRIVE = 0.9;
const VISION_RANGE = 42;
const FOV_COS = 0.34; // ~70 degrees half-angle
const BOT_DAMAGE = 11;
const BOT_HEAD_MULT = 2;

const EMBER_NAMES = ['Kestrel', 'Bram', 'Sable', 'Wren'];
const ASH_NAMES = ['Rook', 'Hale', 'Moss', 'Pike', 'Dusk'];

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export function createBots(scene, colliders, shootables, rng, hooks) {
  const bots = [];
  const liveHitMeshes = [];
  let idCounter = 0;

  function buildMesh(teamColor) {
    const group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.8, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x1c1a18), roughness: 0.85, metalness: 0.1 });
    const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2a2a2e), roughness: 0.5, metalness: 0.5 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
    torso.position.y = 0.86;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.3), dark);
    head.position.y = 1.42;
    head.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.32), cloth);
    band.position.y = 1.5;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.52, 0.17), dark);
    legL.position.set(-0.12, 0.26, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.52, 0.17), dark);
    legR.position.set(0.12, 0.26, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.6), gunMat);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(torso, head, band, legL, legR, gun);
    return { group, torso, head, legL, legR };
  }

  function makeBot(name, team, color) {
    const { mover } = createMover(colliders, 0.34, 1.72);
    const parts = buildMesh(color);
    parts.torso.userData = { bot: null, part: 'body' };
    parts.head.userData = { bot: null, part: 'head' };
    scene.add(parts.group);
    const bot = {
      id: idCounter, name, team,
      mover, mesh: parts.group, headMesh: parts.head, bodyMesh: parts.torso,
      legL: parts.legL, legR: parts.legR,
      hp: 100, alive: true, yaw: 0, pitch: 0,
      state: 'MOVE', route: [], routeIndex: 0, holdPos: null, holdYaw: 0,
      target: null, targetIsPlayer: false, lastSeen: 0, react: 0,
      burst: 0, burstTimer: 0, pauseTimer: 0, fireTimer: 0,
      strafeDir: 1, strafeTimer: 0, stuckTimer: 0, lastX: 0, lastZ: 0,
      sidestep: 0, sidestepDir: 1,
      plantProgress: 0, defuseProgress: 0, carrier: false,
      scanT: 0, thinkTimer: rng() * 0.15, walkPhase: rng() * 6,
      investigate: null, damagedAt: -10, speed: range(rng, 3.6, 4.2),
    };
    parts.torso.userData.bot = bot;
    parts.head.userData.bot = bot;
    idCounter += 1;
    bots.push(bot);
    return bot;
  }

  for (const name of EMBER_NAMES) makeBot(name, 'ember', 0xff7a1a);
  for (const name of ASH_NAMES) makeBot(name, 'ash', 0x8fb4c7);

  function rebuildHitMeshes() {
    liveHitMeshes.length = 0;
    for (const bot of bots) {
      if (bot.alive) {
        liveHitMeshes.push(bot.headMesh, bot.bodyMesh);
      }
    }
  }

  function place(bot, x, z, yaw) {
    bot.mover.position.set(x, 0, z);
    bot.mover.velocity.set(0, 0, 0);
    bot.yaw = yaw;
    bot.hp = 100;
    bot.alive = true;
    bot.state = 'MOVE';
    bot.route = [];
    bot.routeIndex = 0;
    bot.target = null;
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    bot.carrier = false;
    bot.investigate = null;
    bot.mesh.rotation.set(0, yaw, 0);
    bot.mesh.position.copy(bot.mover.position);
    bot.mesh.visible = true;
  }

  function visibleFrom(bot, tx, ty, tz) {
    _eye.set(bot.mover.position.x, EYE, bot.mover.position.z);
    _to.set(tx, ty, tz);
    _dir.subVectors(_to, _eye);
    const dist = _dir.length();
    if (dist > VISION_RANGE) return false;
    _dir.normalize();
    _fwd.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const facing = _fwd.x * _dir.x + _fwd.z * _dir.z;
    const recentDamage = hooks.time - bot.damagedAt < 2;
    if (facing < FOV_COS && dist > 4 && !recentDamage) return false;
    _ray.set(_eye, _dir);
    _ray.far = dist;
    const hit = _ray.intersectObjects(shootables, false)[0];
    return !hit || hit.distance > dist - 0.3;
  }

  function findTarget(bot, env) {
    // Nearest visible enemy: the player or a bot of the other team.
    let best = null;
    let bestDist = Infinity;
    if (env.playerAlive && bot.team !== 'ember') {
      const p = env.playerPos;
      const d = Math.hypot(p.x - bot.mover.position.x, p.z - bot.mover.position.z);
      if (d < bestDist && visibleFrom(bot, p.x, BODY_Y, p.z)) {
        best = { isPlayer: true, pos: p, dist: d };
        bestDist = d;
      }
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      const d = Math.hypot(other.mover.position.x - bot.mover.position.x, other.mover.position.z - bot.mover.position.z);
      if (d >= bestDist) continue;
      if (visibleFrom(bot, other.mover.position.x, BODY_Y, other.mover.position.z)) {
        best = { isPlayer: false, bot: other, pos: other.mover.position, dist: d };
        bestDist = d;
      }
    }
    return best;
  }

  function shootAt(bot, target, env) {
    // One burst round: a ray from the bot's eye toward the target's chest,
    // spread by distance, target speed and whether the bot is moving.
    const tp = target.pos;
    const speed = target.isPlayer ? env.playerSpeed : Math.hypot(target.bot.mover.velocity.x, target.bot.mover.velocity.z);
    const moving = Math.hypot(bot.mover.velocity.x, bot.mover.velocity.z) > 0.5 ? 0.02 : 0;
    const spread = 0.02 + target.dist * 0.0011 + Math.min(1, speed / 5) * 0.012 + moving;
    _eye.set(bot.mover.position.x, EYE, bot.mover.position.z);
    _dir.set(tp.x - _eye.x, BODY_Y - _eye.y, tp.z - _eye.z).normalize();
    _dir.x += (rng() * 2 - 1) * spread;
    _dir.y += (rng() * 2 - 1) * spread * 0.7;
    _dir.z += (rng() * 2 - 1) * spread;
    _dir.normalize();
    const targetMeshes = target.isPlayer ? env.playerMeshes : [target.bot.headMesh, target.bot.bodyMesh];
    const blockers = shootables;
    _ray.set(_eye, _dir);
    _ray.far = 90;
    let first = null;
    let firstDist = Infinity;
    let firstIsTarget = false;
    let firstPart = 'body';
    const h1 = _ray.intersectObjects(blockers, false)[0];
    if (h1) { first = h1.point; firstDist = h1.distance; }
    const h2 = _ray.intersectObjects(targetMeshes, false)[0];
    if (h2 && h2.distance < firstDist) {
      first = h2.point;
      firstDist = h2.distance;
      firstIsTarget = true;
      firstPart = h2.object.userData.part || 'body';
    }
    hooks.tracer(_eye, first || _to.copy(_eye).addScaledVector(_dir, 60), bot.team);
    hooks.shotSound(bot.mover.position, true);
    if (!firstIsTarget) return;
    const dmg = (BOT_DAMAGE + rng() * 4) * (firstPart === 'head' ? BOT_HEAD_MULT : 1);
    if (target.isPlayer) hooks.damagePlayer(dmg, bot, firstPart === 'head');
    else applyDamage(target.bot, dmg, firstPart, bot);
  }

  function applyDamage(bot, dmg, part, attacker) {
    if (!bot.alive) return false;
    bot.hp -= dmg;
    bot.damagedAt = hooks.time;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.state = 'DEAD';
      bot.mesh.rotation.set(0, bot.yaw, Math.PI / 2);
      bot.mesh.position.y = 0.25;
      rebuildHitMeshes();
      hooks.onBotKilled(bot, attacker, part === 'head');
      return true;
    }
    return false;
  }

  function moveToward(bot, dt, x, z, speed) {
    const dx = x - bot.mover.position.x;
    const dz = z - bot.mover.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    _wish.set(dx / dist, 0, dz / dist);
    const stuckNow = Math.hypot(bot.mover.position.x - bot.lastX, bot.mover.position.z - bot.lastZ) < 0.05
      && Math.hypot(bot.mover.velocity.x, bot.mover.velocity.z) < 0.3;
    if (stuckNow) bot.stuckTimer += dt;
    else bot.stuckTimer = 0;
    bot.lastX = bot.mover.position.x;
    bot.lastZ = bot.mover.position.z;
    if (bot.stuckTimer > 1.1) {
      bot.stuckTimer = 0;
      bot.sidestep = 0.7;
      bot.sidestepDir = rng() > 0.5 ? 1 : -1;
    }
    let wx = _wish.x;
    let wz = _wish.z;
    if (bot.sidestep > 0) {
      bot.sidestep -= dt;
      const px = -_wish.z * bot.sidestepDir;
      const pz = _wish.x * bot.sidestepDir;
      wx = (wx + px) * 0.7;
      wz = (wz + pz) * 0.7;
      const l = Math.hypot(wx, wz) || 1;
      wx /= l;
      wz /= l;
    }
    const { mover } = bot;
    const accel = mover.onGround ? 42 : 9;
    const blend = Math.min(1, (accel * dt) / Math.max(0.1, speed));
    mover.velocity.x += (wx * speed - mover.velocity.x) * blend;
    mover.velocity.z += (wz * speed - mover.velocity.z) * blend;
    stepMover(bot, dt);
    // Face where we walk.
    const targetYaw = Math.atan2(-wx, -wz);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += clamp(dy, -dt * 6, dt * 6);
    return dist < ARRIVE;
  }

  function stepMover(bot, dt) {
    // The shared mover, driven by the bot's own wish through its velocity.
    const { mover } = bot;
    mover.velocity.y -= 20 * dt;
    const pos = mover.position;
    const nextX = pos.x + mover.velocity.x * dt;
    const probe = new THREE.Box3();
    probe.min.set(nextX - 0.34, pos.y + 0.04, pos.z - 0.34);
    probe.max.set(nextX + 0.34, pos.y + 1.72 - 0.04, pos.z + 0.34);
    let blockedX = false;
    for (const c of colliders) if (probe.intersectsBox(c)) { blockedX = true; break; }
    if (!blockedX) pos.x = nextX;
    else mover.velocity.x = 0;
    const nextZ = pos.z + mover.velocity.z * dt;
    probe.min.set(pos.x - 0.34, pos.y + 0.04, nextZ - 0.34);
    probe.max.set(pos.x + 0.34, pos.y + 1.72 - 0.04, nextZ + 0.34);
    let blockedZ = false;
    for (const c of colliders) if (probe.intersectsBox(c)) { blockedZ = true; break; }
    if (!blockedZ) pos.z = nextZ;
    else mover.velocity.z = 0;
    pos.y += mover.velocity.y * dt;
    if (pos.y < 0) { pos.y = 0; mover.velocity.y = 0; mover.onGround = true; }
    bot.walkPhase += dt * Math.hypot(mover.velocity.x, mover.velocity.z) * 1.6;
    bot.mesh.position.copy(pos);
    bot.mesh.rotation.y = bot.yaw;
    const swing = Math.hypot(mover.velocity.x, mover.velocity.z) > 0.4 ? Math.sin(bot.walkPhase) * 0.45 : 0;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
  }

  function setRoute(bot, names) {
    bot.route = names.slice();
    bot.routeIndex = 0;
    bot.state = 'MOVE';
  }

  function step(bot, dt, env) {
    if (!bot.alive) return;
    bot.thinkTimer -= dt;
    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = 0.15;
      const found = findTarget(bot, env);
      if (found) {
        if (!bot.target) bot.react = range(rng, 0.35, 0.7);
        bot.target = found;
        bot.lastSeen = hooks.time;
        if (bot.state === 'MOVE' || bot.state === 'HOLD' || bot.state === 'ROTATE') bot.state = 'ENGAGE';
      } else if (bot.target && hooks.time - bot.lastSeen > 1.5) {
        bot.target = null;
        if (bot.state === 'ENGAGE') bot.state = bot.holdPos ? 'HOLD' : 'MOVE';
      }
    }

    if (bot.state === 'ENGAGE' && bot.target) {
      const t = bot.target;
      const dx = t.pos.x - bot.mover.position.x;
      const dz = t.pos.z - bot.mover.position.z;
      const targetYaw = Math.atan2(-dx, -dz);
      let dy = targetYaw - bot.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      bot.yaw += clamp(dy, -dt * 8, dt * 8);
      // Strafe sideways while shooting.
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = range(rng, 0.7, 1.4);
        bot.strafeDir = rng() > 0.5 ? 1 : -1;
      }
      const sx = -Math.cos(bot.yaw) * bot.strafeDir;
      const sz = Math.sin(bot.yaw) * bot.strafeDir;
      const dist = Math.hypot(dx, dz);
      let mx = 0;
      let mz = 0;
      if (dist > 14) { mx = -Math.sin(bot.yaw); mz = -Math.cos(bot.yaw); }
      else if (dist < 5) { mx = Math.sin(bot.yaw); mz = Math.cos(bot.yaw); }
      const { mover } = bot;
      const accel = 42;
      const blend = Math.min(1, (accel * dt) / 2.2);
      mover.velocity.x += ((mx + sx) * 2.2 - mover.velocity.x) * blend;
      mover.velocity.z += ((mz + sz) * 2.2 - mover.velocity.z) * blend;
      stepMover(bot, dt);
      if (bot.react > 0) {
        bot.react -= dt;
      } else {
        bot.fireTimer -= dt;
        if (bot.burst <= 0) {
          bot.pauseTimer -= dt;
          if (bot.pauseTimer <= 0) {
            bot.burst = 3 + Math.floor(rng() * 3);
            bot.pauseTimer = range(rng, 0.5, 1.0);
          }
        } else if (bot.fireTimer <= 0) {
          bot.fireTimer = 0.12;
          bot.burst -= 1;
          shootAt(bot, t, env);
        }
      }
      return;
    }

    if (bot.state === 'PLANT') {
      if (bot.target) {
        bot.state = 'ENGAGE';
        bot.plantProgress = 0;
        return;
      }
      bot.plantProgress += dt;
      hooks.plantTick(bot, bot.plantProgress / 3);
      if (bot.plantProgress >= 3) {
        bot.plantProgress = 0;
        bot.state = 'HOLD';
        const da = Math.hypot(bot.mover.position.x - SITES.A.x, bot.mover.position.z - SITES.A.z);
        const db = Math.hypot(bot.mover.position.x - SITES.B.x, bot.mover.position.z - SITES.B.z);
        hooks.onPlanted(da < db ? 'A' : 'B', bot);
      }
      return;
    }

    if (bot.state === 'DEFUSE') {
      if (bot.target) {
        bot.state = 'ENGAGE';
        bot.defuseProgress = 0;
        return;
      }
      bot.defuseProgress += dt;
      hooks.defuseTick(bot, bot.defuseProgress / 5);
      if (bot.defuseProgress >= 5) {
        bot.defuseProgress = 0;
        bot.state = 'HOLD';
        hooks.onDefused(bot);
      }
      return;
    }

    if (bot.state === 'HOLD' && bot.holdPos) {
      bot.scanT += dt;
      bot.yaw = bot.holdYaw + Math.sin(bot.scanT * 0.5) * 0.9;
      const { mover } = bot;
      mover.velocity.x *= Math.max(0, 1 - 9 * dt);
      mover.velocity.z *= Math.max(0, 1 - 9 * dt);
      stepMover(bot, dt);
      if (bot.investigate && hooks.time < bot.investigate.until) {
        const p = bot.investigate;
        if (moveToward(bot, dt, p.x, p.z, bot.speed)) bot.investigate = null;
      }
      return;
    }

    if (bot.state === 'ROTATE' || bot.state === 'MOVE') {
      if (bot.routeIndex >= bot.route.length) {
        if (bot.state === 'ROTATE') {
          bot.state = 'DEFUSE';
          bot.defuseProgress = 0;
        } else if (bot.carrier && env.bombState === 'carried' && !env.bombPlanted) {
          bot.state = 'PLANT';
          bot.plantProgress = 0;
        } else {
          bot.state = 'HOLD';
          bot.holdPos = { x: bot.mover.position.x, z: bot.mover.position.z };
          bot.holdYaw = bot.yaw;
        }
        return;
      }
      const node = WAYPOINTS[bot.route[bot.routeIndex]];
      if (!node) {
        bot.routeIndex += 1;
        return;
      }
      if (moveToward(bot, dt, node.x, node.z, bot.speed)) bot.routeIndex += 1;
    }
  }

  function hear(x, z, radius) {
    for (const bot of bots) {
      if (!bot.alive || bot.target) continue;
      const d = Math.hypot(bot.mover.position.x - x, bot.mover.position.z - z);
      if (d > radius) continue;
      bot.investigate = { x, z, until: hooks.time + 4 };
      if (bot.state === 'HOLD') {
        const dx = x - bot.mover.position.x;
        const dz = z - bot.mover.position.z;
        bot.holdYaw = Math.atan2(-dx, -dz);
      }
    }
  }

  rebuildHitMeshes();

  return {
    bots,
    hitMeshes: liveHitMeshes,
    place,
    step,
    setRoute,
    hear,
    applyDamage,
    aliveOf(team) {
      return bots.filter((b) => b.team === team && b.alive);
    },
    reset() {
      for (const bot of bots) {
        bot.mesh.rotation.set(0, 0, 0);
        bot.mesh.position.y = 0;
      }
      rebuildHitMeshes();
    },
  };
}
