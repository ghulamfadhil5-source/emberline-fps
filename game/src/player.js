// The player: look, crouch, sprint and jump on top of the shared mover.
// Speed and spread are tied together — sprinting is fast and wild, crouching
// is slow and steady — so stopping to aim pays.
import { createMover } from './mover.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const SPRINT_SPEED = 6.6;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;

export function createPlayer(colliders) {
  const { mover, step: moveStep, overlaps } = createMover(colliders, 0.34, STAND_HEIGHT);
  mover.position.set(0, 0, 15.5);
  const player = {
    position: mover.position,
    velocity: mover.velocity,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    sprinting: false,
    height: STAND_HEIGHT,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    player.sprinting = keys.has('ShiftLeft') && forward > 0 && !player.crouching;
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      const len = Math.hypot(forward, strafe);
      wishX = (-sin * forward + cos * strafe) / len;
      wishZ = (-cos * forward - sin * strafe) / len;
    }
    const speed = player.crouching ? CROUCH_SPEED : player.sprinting ? SPRINT_SPEED : WALK_SPEED;
    moveStep(dt, wishX, wishZ, speed, keys.has('Space'), player.onGround ? GROUND_ACCEL : AIR_ACCEL);
    player.onGround = mover.onGround;
  }

  function groundSpeed() {
    return Math.hypot(player.velocity.x, player.velocity.z);
  }

  return { state: player, step, look, recoil, groundSpeed };
}
