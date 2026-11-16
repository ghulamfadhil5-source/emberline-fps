// A body moving through the map: acceleration, friction and gravity, resolved
// as a box against the world's colliders one axis at a time, so a wall never
// swallows a body. One implementation serves the player and every bot.
import * as THREE from 'three';

const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const FRICTION = 9;

export function createMover(colliders, radius, height) {
  const position = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const probe = new THREE.Box3();
  const mover = {
    position, velocity,
    onGround: true,
    height,
    radius,
  };

  function overlaps(x, y, z, h, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + h - lift, z + radius);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  function step(dt, wishX, wishZ, speed, wantJump, accel) {
    const blend = Math.min(1, (accel * dt) / Math.max(0.1, speed));
    velocity.x += (wishX * speed - velocity.x) * blend;
    velocity.z += (wishZ * speed - velocity.z) * blend;
    if (mover.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      velocity.x *= damp;
      velocity.z *= damp;
    }
    if (wantJump && mover.onGround) {
      velocity.y = JUMP_SPEED;
      mover.onGround = false;
    }
    velocity.y -= GRAVITY * dt;

    const nextX = position.x + velocity.x * dt;
    if (!overlaps(nextX, position.y, position.z, height, 0.04)) position.x = nextX;
    else velocity.x = 0;
    const nextZ = position.z + velocity.z * dt;
    if (!overlaps(position.x, position.y, nextZ, height, 0.04)) position.z = nextZ;
    else velocity.z = 0;

    position.y += velocity.y * dt;
    mover.onGround = false;
    const hit = overlaps(position.x, position.y, position.z, height, 0);
    if (hit && velocity.y <= 0) {
      position.y = hit.max.y;
      velocity.y = 0;
      mover.onGround = true;
    } else if (hit) {
      position.y = hit.min.y - height;
      velocity.y = 0;
    }
    if (position.y < 0) {
      position.y = 0;
      velocity.y = 0;
      mover.onGround = true;
    }
    velocity.y = Math.max(-30, velocity.y);
    return mover;
  }

  function blocked() {
    // True when a horizontal push is being eaten by a wall — bots use it to sidestep.
    return Math.abs(velocity.x) < 0.15 && Math.abs(velocity.z) < 0.15;
  }

  return { mover, step, overlaps, blocked };
}
