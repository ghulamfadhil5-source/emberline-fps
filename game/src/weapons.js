// Weapons: five guns and a grenade, each with its own numbers. The module owns
// the view model, the magazine, the reload and the spread that punishes moving;
// sim.js owns the ray and the damage. Spread grows with speed and shrinks while
// aiming (right mouse), so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 34, headMult: 3, mag: 12, reserve: 48, gap: 0.16, reload: 1.3,
    spreadStill: 0.004, spreadMove: 0.03, pellets: 1, kick: 0.012, auto: false,
    zoom: 1.15, range: 60,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Long Rifle', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, mag: 25, reserve: 100, gap: 0.11, reload: 2.2,
    spreadStill: 0.003, spreadMove: 0.026, pellets: 1, kick: 0.011, auto: true,
    zoom: 1.4, range: 90,
  },
  smg: {
    id: 'smg', name: 'H-9 Hornet SMG', kind: 'smg', price: 1500,
    damage: 24, headMult: 3, mag: 32, reserve: 128, gap: 0.075, reload: 1.9,
    spreadStill: 0.006, spreadMove: 0.034, pellets: 1, kick: 0.008, auto: true,
    zoom: 1.15, range: 55,
  },
  shotgun: {
    id: 'shotgun', name: 'S-12 Scattergun', kind: 'shotgun', price: 1700,
    damage: 9, headMult: 2, mag: 6, reserve: 24, gap: 0.85, reload: 2.6,
    spreadStill: 0.03, spreadMove: 0.05, pellets: 8, kick: 0.03, auto: false,
    zoom: 1.1, range: 30,
  },
  dmr: {
    id: 'dmr', name: 'L-88 Longshot DMR', kind: 'dmr', price: 3400,
    damage: 105, headMult: 4, mag: 5, reserve: 15, gap: 1.1, reload: 3.0,
    spreadStill: 0.0008, spreadMove: 0.02, pellets: 1, kick: 0.035, auto: false,
    zoom: 2.6, range: 120,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const AMMO_PRICE = 200;

const MODEL_SHAPES = {
  pistol: { receiver: [0.06, 0.09, 0.26], barrel: [0.04, 0.04, 0.16], grip: [0.05, 0.12, 0.06] },
  rifle: { receiver: [0.09, 0.1, 0.46], barrel: [0.045, 0.045, 0.42], grip: [0.07, 0.09, 0.2] },
  smg: { receiver: [0.08, 0.09, 0.34], barrel: [0.04, 0.04, 0.24], grip: [0.06, 0.1, 0.08] },
  shotgun: { receiver: [0.1, 0.11, 0.5], barrel: [0.06, 0.06, 0.46], grip: [0.08, 0.09, 0.2] },
  dmr: { receiver: [0.09, 0.1, 0.56], barrel: [0.04, 0.04, 0.5], grip: [0.07, 0.09, 0.24] },
};

export function createWeapons(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  model.position.set(0.28, -0.26, -0.5);
  model.scale.setScalar(0.7);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    owned: { pistol: { mag: 12, reserve: 48 } },
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
    grenades: 0, armor: 0,
  };

  function rebuildModel() {
    while (model.children.length) {
      const child = model.children.pop();
      child.geometry.dispose();
    }
    const shape = MODEL_SHAPES[state.current];
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(...shape.receiver), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(...shape.barrel), gripMat);
    barrel.position.set(0, 0.02, -(shape.receiver[2] / 2 + shape.barrel[2] / 2 - 0.05));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(...shape.grip), gripMat);
    grip.position.set(0, -0.05, shape.receiver[2] / 2 - 0.08);
    model.add(receiver, barrel, grip);
    if (state.current === 'dmr') {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.22), accentMat);
      scope.position.set(0, 0.09, -0.05);
      model.add(scope);
    } else {
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accentMat);
      sight.position.set(0, 0.08, -0.12);
      model.add(sight);
    }
  }

  rebuildModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      const def = WEAPONS[state.current];
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = state.owned[state.current];
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    defs: WEAPONS,
    step,
    currentDef() {
      return WEAPONS[state.current];
    },
    ready() {
      const slot = state.owned[state.current];
      return slot && slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      const slot = state.owned[state.current];
      if (!slot || slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.current];
      const slot = state.owned[state.current];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed, aiming) {
      const def = WEAPONS[state.current];
      const moving = Math.min(1, speed / 5.2);
      let s = def.spreadStill + moving * def.spreadMove;
      if (aiming) s *= 0.45;
      return s;
    },
    equip(id) {
      if (!state.owned[id]) return false;
      state.current = id;
      state.cooldown = 0;
      state.reloadLeft = 0;
      rebuildModel();
      return true;
    },
    buy(id, money) {
      const def = WEAPONS[id];
      if (!def || state.owned[id] || money < def.price) return money;
      state.owned[id] = { mag: def.mag, reserve: def.reserve };
      this.equip(id);
      return money - def.price;
    },
    refillAll() {
      for (const id of Object.keys(state.owned)) {
        const def = WEAPONS[id];
        state.owned[id].mag = def.mag;
        state.owned[id].reserve = def.reserve;
      }
      state.reloadLeft = 0;
      state.cooldown = 0;
    },
    resetRound() {
      state.owned = { pistol: { mag: 12, reserve: 48 } };
      state.current = 'pistol';
      state.grenades = 0;
      state.armor = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      rebuildModel();
    },
  };
}
