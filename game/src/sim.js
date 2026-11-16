// The simulation: one state object holds the whole match — phase, round,
// money, the bomb, the grenades, the tracers — and one fixed 60 Hz step moves
// it. Rendering only reads this state; nothing here draws. The player shoots
// with a real raycast against bot bodies (headshots pay), bots shoot back
// through their own module, and the round ends by elimination, by the clock,
// or by the charge.
import * as THREE from 'three';
import { SITES, SPAWNS, ROUTES, WAYPOINTS } from './map.js';
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE, AMMO_PRICE } from './weapons.js';
import { clamp, pick } from './rng.js';

const ROUND_TIME = 100;
const BUY_TIME = 15;
const FUSE_TIME = 35;
const PLANT_TIME = 3;
const WIN_ROUNDS = 5;
const TRACER_LIFE = 0.09;

const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export function createSim(deps) {
  const { scene, camera, player, weapons, bots, mapData, hud, audio, input, rng, hooks } = deps;
  const { colliders, shootables } = mapData;

  // The one state object.
  const state = {
    phase: 'lobby',
    round: 1,
    wins: { ember: 0, ash: 0 },
    money: 800,
    timer: ROUND_TIME,
    buyTimer: BUY_TIME,
    bomb: { state: 'carried', carrier: 'player', site: null, fuse: FUSE_TIME, pos: new THREE.Vector3() },
    plantProgress: 0,
    defuseCountdown: 0,
    playerHp: 100,
    playerAlive: true,
    roundEndTimer: 0,
    roundEndReason: '',
    shake: 0,
    beepTimer: 0,
    hudTimer: 0,
    spectate: null,
  };

  const prevKeys = new Set();
  let buyOpen = false;
  const env = {
    playerAlive: true, playerPos: player.state.position, playerSpeed: 0,
    playerMeshes: [], bombState: 'carried', bombPlanted: false, plantSite: 'A',
  };

  // Player hitboxes: invisible boxes the bots' rays test against.
  const ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const playerBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.15, 0.7), ghostMat);
  const playerHead = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.42), ghostMat);
  playerBody.userData = { part: 'body' };
  playerHead.userData = { part: 'head' };
  scene.add(playerBody, playerHead);
  env.playerMeshes = [playerHead, playerBody];

  // The bomb: a dark case with a blinking light, carried or planted.
  const bombGroup = new THREE.Group();
  const bombCase = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.24, 0.55),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x1c1a18), roughness: 0.6, metalness: 0.4 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a) }),
  );
  bombLight.position.set(0.12, 0.16, 0.1);
  bombGroup.add(bombCase, bombLight);
  bombGroup.visible = false;
  scene.add(bombGroup);
  const bombGlow = new THREE.PointLight(new THREE.Color(0xff2a1a), 0, 8, 1.8);
  scene.add(bombGlow);

  // Tracers: a fixed pool of lines, reused, never allocated in the loop.
  const tracers = [];
  for (let i = 0; i < 32; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;
  const tracerColors = { ember: 0xffc27a, ash: 0x9fd4e8 };

  // Grenades in flight.
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2e4a2e), roughness: 0.5, metalness: 0.4 });
  const boomGeo = new THREE.SphereGeometry(1, 16, 12);
  const boomMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040), transparent: true, opacity: 0 });
  const boom = new THREE.Mesh(boomGeo, boomMat);
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(new THREE.Color(0xff8a20), 0, 22, 1.5);
  scene.add(boomLight);
  let boomT = 0;

  function tracer(from, to, team) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(tracerColors[team] || 0xffc27a);
    t.life = TRACER_LIFE;
    t.line.material.opacity = 0.9;
  }

  function nearestSite(x, z) {
    const da = Math.hypot(x - SITES.A.x, z - SITES.A.z);
    const db = Math.hypot(x - SITES.B.x, z - SITES.B.z);
    return da < db ? 'A' : 'B';
  }

  function siteAt(x, z) {
    const s = nearestSite(x, z);
    const site = SITES[s];
    return Math.hypot(x - site.x, z - site.z) <= site.radius ? s : null;
  }

  // ---- hooks the bots call back into (the shared object main.js hands both
  // modules, so the bots' closure and this module write the same fields) ----
  hooks.time = 0;
  hooks.tracer = tracer;
  hooks.shotSound = function shotSound(pos, distant) {
    audio.shot('rifle', distant);
  };
  hooks.damagePlayer = function damagePlayer(dmg, bot, headshot) {
    if (!state.playerAlive || state.phase !== 'live') return;
    let left = dmg;
    if (weapons.state.armor > 0) {
      const absorbed = Math.min(weapons.state.armor, left * 0.5);
      weapons.state.armor -= absorbed;
      left -= absorbed;
    }
    state.playerHp -= left;
    audio.hurt();
    if (state.playerHp <= 0) {
      state.playerHp = 0;
      state.playerAlive = false;
      hud.showOverlay('dead');
      input.releaseLock();
      const alive = bots.aliveOf('ember');
      state.spectate = alive.length ? pick(rng, alive) : null;
      hud.setSpectate(state.spectate ? `Spectating ${state.spectate.name}` : '');
      if (state.bomb.carrier === 'player') reassignCarrier();
      checkRoundEnd();
    }
  };
  hooks.onBotKilled = function onBotKilled(bot, attacker, headshot) {
    const killer = attacker && attacker.name ? attacker.name : 'You';
    hud.feed(`${killer} ✕ ${bot.name}${headshot ? ' (headshot)' : ''}`, bot.team === 'ash');
    if (bot.team === 'ash') {
      state.money += 300;
      audio.kill();
    }
    if (bot.carrier) reassignCarrier();
    checkRoundEnd();
  };
  hooks.plantTick = function plantTick(bot, frac) {
    hud.setBomb(`${bot.name} is planting at Site ${nearestSite(bot.mover.position.x, bot.mover.position.z)}…`);
  };
  hooks.defuseTick = function defuseTick(bot, frac) {
    hud.setBomb(`⚠ ${bot.name} IS DEFUSING — ${Math.ceil((1 - frac) * 5)}s`);
  };
  hooks.onPlanted = function onPlanted(site, bot) {
    state.bomb.state = 'planted';
    state.bomb.site = site;
    state.bomb.fuse = FUSE_TIME;
    state.bomb.pos.set(SITES[site].x, 0.2, SITES[site].z);
    if (bot && bot.name) hud.feed(`${bot.name} planted the charge at Site ${site}`, true);
    audio.plantDone();
    for (const ash of bots.aliveOf('ash')) {
      const d = Math.hypot(ash.mover.position.x - SITES[site].x, ash.mover.position.z - SITES[site].z);
      if (d < 5) {
        ash.state = 'DEFUSE';
        ash.defuseProgress = 0;
      } else {
        bots.setRoute(ash, [site === 'A' ? 'aSite' : 'bSite']);
        ash.state = 'ROTATE';
      }
    }
    checkRoundEnd();
  };
  hooks.onDefused = function onDefused(bot) {
    hud.feed(`${bot.name} defused the charge`, false);
    endRound('ash', 'Charge defused');
  };

  function reassignCarrier() {
    const alive = bots.aliveOf('ember');
    if (!alive.length) {
      state.bomb.state = 'dropped';
      state.bomb.carrier = null;
      return;
    }
    const next = alive[0];
    next.carrier = true;
    state.bomb.carrier = next.id;
    state.bomb.state = 'carried';
    const site = next.route.length ? nearestSite(WAYPOINTS[next.route[next.route.length - 1]].x, WAYPOINTS[next.route[next.route.length - 1]].z) : 'A';
    bots.setRoute(next, site === 'A' ? ROUTES.toA : ROUTES.toB);
  }

  // ---- shooting ----
  function shoot() {
    if (state.phase !== 'live' || !state.playerAlive) return;
    if (!weapons.ready()) {
      if (weapons.state.owned[weapons.state.current].mag === 0) weapons.reload();
      return;
    }
    const def = weapons.currentDef();
    if (!weapons.takeRound()) {
      audio.dryFire();
      weapons.reload();
      return;
    }
    camera.getWorldDirection(_dir);
    _muzzle.copy(camera.position).addScaledVector(_dir, 0.6);
    _muzzle.y -= 0.12;
    const spread = weapons.spread(player.groundSpeed(), input.state.aiming);
    for (let p = 0; p < def.pellets; p += 1) {
      _to.copy(_dir);
      _to.x += (rng() * 2 - 1) * spread;
      _to.y += (rng() * 2 - 1) * spread;
      _to.z += (rng() * 2 - 1) * spread;
      _to.normalize();
      _ray.set(camera.position, _to);
      _ray.far = def.range;
      const hWorld = _ray.intersectObjects(shootables, false)[0];
      const hBot = _ray.intersectObjects(bots.hitMeshes, false)[0];
      let end = null;
      if (hBot && (!hWorld || hBot.distance < hWorld.distance)) {
        const bot = hBot.object.userData.bot;
        const part = hBot.object.userData.part || 'body';
        if (bot && bot.alive) {
          const dmg = def.damage * (part === 'head' ? def.headMult : 1);
          const killed = bots.applyDamage(bot, dmg, part, { name: 'You', team: 'ember' });
          hud.hitMarker(killed, killed ? 600 : 90);
          audio.hit();
          end = hBot.point;
        }
      }
      if (!end) {
        end = hWorld ? hWorld.point : _from.copy(camera.position).addScaledVector(_to, def.range);
      }
      tracer(_muzzle, end, 'ember');
    }
    weapons.pullTrigger();
    player.recoil(def.kick + rng() * 0.004, (rng() * 2 - 1) * 0.004);
    audio.shot(def.kind);
    bots.hear(player.state.position.x, player.state.position.z, 30);
    hud.setAmmo(weapons.state.owned[weapons.state.current].mag, weapons.state.owned[weapons.state.current].reserve, def.name);
    if (weapons.state.owned[weapons.state.current].mag === 0) weapons.reload();
  }

  function throwGrenade() {
    if (state.phase !== 'live' || !state.playerAlive || weapons.state.grenades <= 0) return;
    weapons.state.grenades -= 1;
    audio.grenadePin();
    camera.getWorldDirection(_dir);
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.castShadow = true;
    mesh.position.copy(camera.position).addScaledVector(_dir, 0.5);
    mesh.position.y -= 0.1;
    scene.add(mesh);
    grenades.push({
      mesh,
      vel: new THREE.Vector3(_dir.x * 16, _dir.y * 16 + 3.5, _dir.z * 16),
      fuse: 1.6,
    });
    hud.setAmmo(weapons.state.owned[weapons.state.current].mag, weapons.state.owned[weapons.state.current].reserve, weaponLabel());
  }

  function weaponLabel() {
    const def = weapons.currentDef();
    const g = weapons.state.grenades;
    return g > 0 ? `${def.name} · ${g} frag` : def.name;
  }

  function explode(g) {
    const pos = g.mesh.position;
    scene.remove(g.mesh);
    boom.position.copy(pos);
    boom.visible = true;
    boomT = 0.35;
    boomLight.position.copy(pos);
    boomLight.intensity = 60;
    state.shake = Math.min(1, state.shake + 0.8);
    audio.explosion();
    bots.hear(pos.x, pos.z, 45);
    const victims = [];
    for (const bot of bots.bots) if (bot.alive) victims.push(bot);
    for (const bot of victims) {
      const d = Math.hypot(bot.mover.position.x - pos.x, bot.mover.position.z - pos.z);
      if (d > 8) continue;
      _eye.set(pos.x, pos.y, pos.z);
      _dir.set(bot.mover.position.x - pos.x, 1.15 - pos.y, bot.mover.position.z - pos.z);
      const dist = _dir.length();
      _dir.normalize();
      _ray.set(_eye, _dir);
      _ray.far = dist;
      if (_ray.intersectObjects(shootables, false)[0]) continue;
      const dmg = 20 + 90 * (1 - d / 8);
      bots.applyDamage(bot, dmg, 'body', { name: 'You', team: 'ember' });
    }
    if (state.playerAlive) {
      const d = Math.hypot(player.state.position.x - pos.x, player.state.position.z - pos.z);
      if (d < 8) {
        _eye.set(pos.x, pos.y, pos.z);
        _dir.set(player.state.position.x - pos.x, 1.2 - pos.y, player.state.position.z - pos.z);
        const dist = _dir.length();
        _dir.normalize();
        _ray.set(_eye, _dir);
        _ray.far = dist;
        if (!_ray.intersectObjects(shootables, false)[0]) {
          hooks.damagePlayer(20 + 90 * (1 - d / 8), null, false);
        }
      }
    }
  }

  const _eye = new THREE.Vector3();

  // ---- rounds ----
  function assignBots() {
    const ember = bots.aliveOf('ember');
    const ash = bots.aliveOf('ash');
    const emberRoutes = [ROUTES.toA, ROUTES.toB, ROUTES.toMid, rng() > 0.5 ? ROUTES.toA : ROUTES.toB];
    ember.forEach((bot, i) => {
      bots.setRoute(bot, emberRoutes[i % emberRoutes.length]);
      bot.carrier = false;
    });
    const ashHolds = ['aHold1', 'aHold2', 'bHold1', 'bHold2', 'midHold'];
    ash.forEach((bot, i) => {
      const node = ashHolds[i % ashHolds.length];
      bots.setRoute(bot, [node]);
      bot.holdPos = { x: WAYPOINTS[node].x, z: WAYPOINTS[node].z };
      bot.holdYaw = node.startsWith('a') ? Math.PI * 0.75 : node.startsWith('b') ? Math.PI * 0.25 : 0;
    });
  }

  function startRound() {
    for (const g of grenades) scene.remove(g.mesh);
    grenades.length = 0;
    boom.visible = false;
    boomLight.intensity = 0;
    state.bomb.state = 'carried';
    state.bomb.carrier = 'player';
    state.bomb.site = null;
    state.bomb.fuse = FUSE_TIME;
    state.plantProgress = 0;
    state.defuseCountdown = 0;
    state.playerHp = 100;
    state.playerAlive = true;
    state.spectate = null;
    state.timer = ROUND_TIME;
    state.buyTimer = BUY_TIME;
    state.phase = 'buy';
    const emberSpawns = SPAWNS.ember;
    const ashSpawns = SPAWNS.ash;
    bots.bots.forEach((bot, i) => {
      const s = bot.team === 'ember' ? emberSpawns[i % emberSpawns.length] : ashSpawns[i % ashSpawns.length];
      bots.place(bot, s.x, s.z, s.yaw);
    });
    bots.reset();
    assignBots();
    const ps = SPAWNS.ember[2];
    player.state.position.set(ps.x, 0, ps.z);
    player.state.velocity.set(0, 0, 0);
    player.state.yaw = ps.yaw;
    player.state.pitch = 0;
    weapons.refillAll();
    hud.setHealth(100, weapons.state.armor);
    hud.setAmmo(weapons.state.owned.pistol.mag, weapons.state.owned.pistol.reserve, weaponLabel());
    hud.setMoney(state.money);
    hud.setScore(state.wins.ember, state.wins.ash, state.round);
    hud.setBomb('');
    hud.setSpectate('');
    hud.setProgress(null, 0);
    hud.hideOverlay();
    openBuy();
    hud.banner(`ROUND ${state.round}`, 'Buy phase — gear up, then the yard is live', 3000);
  }

  function openBuy() {
    buyOpen = true;
    const items = [];
    const defs = Object.values(WEAPONS);
    defs.forEach((def, i) => {
      items.push({
        key: String(i + 1), name: def.name, price: def.price,
        owned: !!weapons.state.owned[def.id],
        affordable: state.money >= def.price,
      });
    });
    items.push({ key: '6', name: 'Ember Frag grenade', price: GRENADE_PRICE, owned: false, affordable: state.money >= GRENADE_PRICE });
    items.push({ key: '7', name: 'Kevlar vest', price: ARMOR_PRICE, owned: weapons.state.armor > 0, affordable: state.money >= ARMOR_PRICE });
    items.push({ key: '8', name: 'Refill all ammo', price: AMMO_PRICE, owned: false, affordable: state.money >= AMMO_PRICE });
    hud.setBuyOpen(true, items, state.money);
  }

  function buy(key) {
    const defs = Object.values(WEAPONS);
    const idx = Number(key) - 1;
    if (idx >= 0 && idx < defs.length) {
      const def = defs[idx];
      if (weapons.state.owned[def.id]) {
        weapons.equip(def.id);
        audio.click();
      } else if (state.money >= def.price) {
        state.money = weapons.buy(def.id, state.money);
        audio.buy();
        hud.feed(`Bought ${def.name}`, true);
      } else audio.denied();
    } else if (key === '6') {
      if (state.money >= GRENADE_PRICE && weapons.state.grenades < 2) {
        state.money -= GRENADE_PRICE;
        weapons.state.grenades += 1;
        audio.buy();
      } else audio.denied();
    } else if (key === '7') {
      if (state.money >= ARMOR_PRICE && weapons.state.armor <= 0) {
        state.money -= ARMOR_PRICE;
        weapons.state.armor = 100;
        audio.buy();
      } else audio.denied();
    } else if (key === '8') {
      if (state.money >= AMMO_PRICE) {
        state.money -= AMMO_PRICE;
        weapons.refillAll();
        audio.buy();
      } else audio.denied();
    }
    hud.setMoney(state.money);
    hud.setAmmo(weapons.state.owned[weapons.state.current].mag, weapons.state.owned[weapons.state.current].reserve, weaponLabel());
    openBuy();
  }

  function checkRoundEnd() {
    if (state.phase !== 'live') return;
    const emberAlive = bots.aliveOf('ember').length + (state.playerAlive ? 1 : 0);
    const ashAlive = bots.aliveOf('ash').length;
    if (state.bomb.state === 'planted') {
      if (ashAlive === 0) endRound('ember', 'Site cleared — charge detonates');
      else if (emberAlive === 0 && state.defuseCountdown <= 0) state.defuseCountdown = 5;
    } else {
      if (ashAlive === 0) endRound('ember', 'Ash team wiped');
      else if (emberAlive === 0) endRound('ash', 'Ember team wiped');
    }
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.wins[winner] += 1;
    if (winner === 'ember') state.money += 3250;
    else state.money += 1900;
    state.phase = 'roundEnd';
    state.roundEndTimer = 5;
    state.roundEndReason = reason;
    hud.setScore(state.wins.ember, state.wins.ash, state.round);
    hud.setMoney(state.money);
    hud.setBomb('');
    hud.setProgress(null, 0);
    hud.setBuyOpen(false, [], state.money);
    if (winner === 'ember') {
      hud.banner('ROUND WON', reason, 4200);
      audio.roundWin();
    } else {
      hud.banner('ROUND LOST', reason, 4200);
      audio.roundLose();
    }
    input.releaseLock();
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const won = state.wins.ember > state.wins.ash;
    hud.showOverlay('match', {
      title: won ? 'EMBERLINE CHAMPIONS' : 'ASH TAKES THE YARD',
      sub: `Final score Ember ${state.wins.ember} — ${state.wins.ash} Ash. ${won ? 'The yard is yours.' : 'Run it back.'}`,
    });
    input.releaseLock();
  }

  function startMatch() {
    state.wins = { ember: 0, ash: 0 };
    state.round = 1;
    state.money = 800;
    weapons.resetRound();
    startRound();
  }

  // ---- the fixed step ----
  function step(dt, keys) {
    hooks.time += dt;
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / TRACER_LIFE) * 0.9;
      }
    }
    if (boomT > 0) {
      boomT -= dt;
      const f = 1 - boomT / 0.35;
      boom.scale.setScalar(0.5 + f * 7);
      boomMat.opacity = Math.max(0, 0.85 * (1 - f));
      boomLight.intensity = Math.max(0, 60 * (1 - f));
      if (boomT <= 0) boom.visible = false;
    }
    state.shake = Math.max(0, state.shake - dt * 2.2);

    // Edge-detected keys.
    const pressed = new Set();
    for (const k of keys) if (!prevKeys.has(k)) pressed.add(k);
    prevKeys.clear();
    for (const k of keys) prevKeys.add(k);

    if (state.phase === 'buy') {
      state.buyTimer -= dt;
      if (pressed.has('KeyB')) {
        buyOpen = !buyOpen;
        if (buyOpen) openBuy();
        else hud.setBuyOpen(false, [], state.money);
      }
      for (const k of pressed) {
        if (k.startsWith('Digit')) buy(k.slice(5));
      }
      if (pressed.has('KeyQ')) {
        const owned = Object.keys(weapons.state.owned);
        const i = owned.indexOf(weapons.state.current);
        weapons.equip(owned[(i + 1) % owned.length]);
      }
      if (state.buyTimer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_TIME;
        buyOpen = false;
        hud.setBuyOpen(false, [], state.money);
        hud.banner('ROUND LIVE', 'Plant the charge or wipe the Ash team', 2200);
      }
    }

    if (state.phase === 'live') {
      state.timer -= dt;
      if (state.bomb.state === 'planted') {
        state.bomb.fuse -= dt;
        state.beepTimer -= dt;
        if (state.beepTimer <= 0) {
          audio.beep(state.bomb.fuse < 10);
          state.beepTimer = state.bomb.fuse < 10 ? 0.5 : 1.0;
        }
        if (state.bomb.fuse <= 0) {
          state.bomb.fuse = 0;
          endRound('ember', 'Charge detonated');
        }
      }
      if (state.defuseCountdown > 0) {
        state.defuseCountdown -= dt;
        if (state.defuseCountdown <= 0) endRound('ash', 'Charge defused');
      }
      if (state.timer <= 0 && state.bomb.state !== 'planted') {
        state.timer = 0;
        endRound('ash', 'Time expired — Ash holds the yard');
      }

      // Player input.
      const look = input.takeLook();
      player.look(look.x, look.y);
      if (input.state.firing && state.playerAlive) shoot();
      if (keys.has('KeyR')) weapons.reload();
      if (pressed.has('KeyG')) throwGrenade();
      if (pressed.has('KeyQ')) {
        const owned = Object.keys(weapons.state.owned);
        const i = owned.indexOf(weapons.state.current);
        weapons.equip(owned[(i + 1) % owned.length]);
        hud.setAmmo(weapons.state.owned[weapons.state.current].mag, weapons.state.owned[weapons.state.current].reserve, weaponLabel());
      }
      // Plant: hold E inside a site while carrying the charge.
      if (state.playerAlive && state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
        const site = siteAt(player.state.position.x, player.state.position.z);
        if (site && keys.has('KeyE')) {
          state.plantProgress += dt;
          hud.setProgress(`PLANTING AT SITE ${site}`, state.plantProgress / PLANT_TIME);
          if (state.plantProgress >= PLANT_TIME) {
            state.plantProgress = 0;
            hud.setProgress(null, 0);
            state.money += 300;
            hooks.onPlanted(site, { name: 'You' });
          }
        } else if (state.plantProgress > 0) {
          state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
          hud.setProgress(state.plantProgress > 0 ? 'PLANTING…' : null, state.plantProgress / PLANT_TIME);
        }
      }
      player.step(dt, keys);
      weapons.step(dt);
    }

    if (state.phase === 'roundEnd') {
      state.roundEndTimer -= dt;
      if (state.roundEndTimer <= 0) {
        if (state.wins.ember >= WIN_ROUNDS || state.wins.ash >= WIN_ROUNDS) endMatch();
        else {
          state.round += 1;
          startRound();
        }
      }
    }

    // Bots only think while a round is live: during the buy phase they hold
    // their spawns, so nobody dies before the round starts.
    if (state.phase === 'live') {
      env.playerAlive = state.playerAlive;
      env.playerSpeed = player.groundSpeed();
      env.bombState = state.bomb.state;
      env.bombPlanted = state.bomb.state === 'planted';
      env.plantSite = state.bomb.site || nearestSite(player.state.position.x, player.state.position.z);
      for (const bot of bots.bots) bots.step(bot, dt, env);
    }

    // Grenades.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 12 * dt;
      const p = g.mesh.position;
      p.x += g.vel.x * dt;
      p.y += g.vel.y * dt;
      p.z += g.vel.z * dt;
      const r = 0.12;
      for (const c of colliders) {
        if (p.x > c.min.x - r && p.x < c.max.x + r && p.y > c.min.y - r && p.y < c.max.y + r && p.z > c.min.z - r && p.z < c.max.z + r) {
          const dxl = p.x - (c.min.x - r);
          const dxr = (c.max.x + r) - p.x;
          const dyl = p.y - (c.min.y - r);
          const dyr = (c.max.y + r) - p.y;
          const dzl = p.z - (c.min.z - r);
          const dzr = (c.max.z + r) - p.z;
          const m = Math.min(dxl, dxr, dyl, dyr, dzl, dzr);
          if (m === dxl || m === dxr) g.vel.x *= -0.45;
          else if (m === dyl || m === dyr) g.vel.y *= -0.45;
          else g.vel.z *= -0.45;
          break;
        }
      }
      if (Math.hypot(g.vel.x, g.vel.y, g.vel.z) < 1.5) g.vel.set(0, 0, 0);
      if (g.fuse <= 0) {
        explode(g);
        grenades.splice(i, 1);
      }
    }

    // Bomb mesh follows its carrier or its planted site; its light blinks.
    if (state.bomb.state === 'carried') {
      bombGroup.visible = true;
      if (state.bomb.carrier === 'player' && state.playerAlive) {
        bombGroup.position.set(player.state.position.x, 0.35, player.state.position.z);
      } else {
        const carrier = bots.bots.find((b) => b.id === state.bomb.carrier);
        if (carrier && carrier.alive) bombGroup.position.set(carrier.mover.position.x, 0.35, carrier.mover.position.z);
      }
      bombGlow.intensity = 0;
    } else if (state.bomb.state === 'planted') {
      bombGroup.visible = true;
      bombGroup.position.copy(state.bomb.pos);
      bombLight.material.color.setHex(Math.sin(hooks.time * 8) > 0 ? 0xff2a1a : 0x440000);
      bombGlow.position.copy(state.bomb.pos).y = 1;
      bombGlow.intensity = 4 + Math.sin(hooks.time * 8) * 2;
    } else {
      bombGroup.visible = false;
      bombGlow.intensity = 0;
    }

    // Player hitboxes follow the body.
    playerBody.position.set(player.state.position.x, 0.95, player.state.position.z);
    playerHead.position.set(player.state.position.x, 1.5, player.state.position.z);

    // HUD, throttled for the teammate list.
    hud.setHealth(state.playerHp, weapons.state.armor);
    if (state.phase === 'live') hud.setTimer(state.bomb.state === 'planted' ? state.bomb.fuse : state.timer, state.bomb.state === 'planted');
    else if (state.phase === 'buy') hud.setTimer(state.buyTimer, false);
    hud.setScore(state.wins.ember, state.wins.ash, state.round);
    const spreadPx = 6 + weapons.spread(player.groundSpeed(), input.state.aiming) * 500;
    hud.setSpread(spreadPx);
    state.hudTimer -= dt;
    if (state.hudTimer <= 0) {
      state.hudTimer = 0.25;
      const mates = [{ name: 'You', hp: state.playerHp, alive: state.playerAlive, color: '#ff7a1a' }];
      for (const bot of bots.bots) {
        if (bot.team === 'ember') mates.push({ name: bot.name, hp: bot.hp, alive: bot.alive, color: '#ff7a1a' });
      }
      for (const bot of bots.bots) {
        if (bot.team === 'ash') mates.push({ name: bot.name, hp: bot.hp, alive: bot.alive, color: '#8fb4c7' });
      }
      hud.setTeammates(mates);
      if (state.bomb.state === 'planted') {
        hud.setBomb(`💣 CHARGE PLANTED — Site ${state.bomb.site} — ${Math.ceil(state.bomb.fuse)}s`);
      }
    }
  }

  return { state, step, startMatch, startRound, shoot, buy, hooks };
}
