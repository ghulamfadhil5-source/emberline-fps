# EMBERLINE — Foundry Yard

[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/ghulamfadhil5-source/emberline-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/ghulamfadhil5-source/emberline-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02)

A round-based tactical FPS in the browser, built on three.js 0.187.0. Five
Ember attackers against five Ash defenders in the Foundry Yard: plant the
charge at Furnace or Depot, or wipe the other team. Money earned each round
buys rifles, SMGs, a shotgun, a DMR, frags and kevlar in the buy menu.

Made for the [make.fun bounty "Make the best three.js tactical FPS"](https://make.fun/bounty/threejs-fps-02).

## Play

Serve `game/` with any static file server and open it in desktop Chrome:

```sh
python3 -m http.server 8080 --directory game
# open http://localhost:8080
```

No build step, no network requests, no external assets — three.js is vendored
under `game/vendor/three/`, sounds are synthesised with WebAudio.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (Shift sprint, Ctrl/C crouch, Space jump) |
| Mouse | Look (pointer lock) |
| Click | Fire · Right mouse: aim |
| R | Reload · Q: switch weapon · G: throw frag |
| E (hold) | Plant the charge inside a site |
| B / 1–8 | Buy menu (buy phase) |

## The game

- **Rounds:** 100-second rounds, first to 5. Win by elimination, by
  detonating the planted charge, or (as Ash) by letting the clock run out or
  defusing. The charge fuses in 35 seconds once planted.
- **Economy:** $800 to start, +$300 a kill, +$300 a plant, +$3,250 a round
  won, +$1,900 a round lost. Five guns (P9 Sidearm, VK-47 rifle, H-9 SMG,
  S-12 scattergun, L-88 DMR), frag grenades and kevlar.
- **Gunplay:** hitscan with headshot multipliers, recoil and spread that grow
  with movement and shrink while aiming, acceleration-based movement with
  crouch and collision against the map.
- **Bots:** nine AI fighters that walk waypoint routes to the sites, hold
  positions, scan, engage in bursts with a reaction delay, strafe, plant and
  defuse, rotate to a planted charge, and turn toward gunfire they hear.
- **Map:** an original 46 × 38 m foundry yard — Furnace (A) and Depot (B)
  sites, three lanes, crates and low walls for cover, dusk lighting.

## Layout

```
game/            the playable game (static ES modules)
  index.html     page + HUD + import map for three.js
  src/
    main.js      boot, fixed 60 Hz loop, screenshot + autopilot modes
    sim.js       the one state object: rounds, economy, bomb, grenades
    bots.js      bot AI: routes, vision, bursts, plant/defuse
    map.js       Foundry Yard geometry, waypoints, lighting
    weapons.js   five guns, view models, magazines, spread
    player.js    look, crouch, sprint, jump
    mover.js     shared AABB movement for player and bots
    input.js     pointer lock + keyboard
    hud.js       DOM HUD: health, ammo, timer, score, buy menu
    audio.js     synthesised WebAudio effects
    palette.js   the six-colour dusk palette
    rng.js       seeded randomness
  vendor/three/  three.js 0.187.0 (byte-for-byte vendored)
vendor/makefun-threejs.ts  the kit's dossier library, unchanged
main.ts          copies game/ + screenshots/ to /output, writes dossier.json
```

Deterministic screenshots: `?shot=start|play|site|end&seed=1` renders a fixed
frame and sets `window.__shotReady`. `?auto=1` runs an autopilot that plays
the game on its own.

## License

MIT — see [LICENSE](LICENSE).
