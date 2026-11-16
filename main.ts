// EMBERLINE — the entry program (Node 22, standard library only).
//
// It hands the game in: it copies this repository's game/ (the playable
// three.js FPS, static ES modules) and screenshots/ (four real renders) into
// the output directory and writes output/dossier.json with the vendored
// make.fun library, the same file the scorer runs on what is handed in.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// and serve the result with any static file server, e.g.
//   python3 -m http.server 8080 --directory out/game
// then open http://localhost:8080 in desktop Chrome.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');

function countImages(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => /\.(png|jpe?g)$/i.test(name)).length;
}

function handIn() {
  if (!existsSync(gameDir)) {
    throw new Error(`game/ is missing beside main.ts (${repoRoot})`);
  }
  const shots = countImages(shotsDir);
  if (shots < 3 || shots > 4) {
    throw new Error(`screenshots/ holds ${shots} images; the bounty takes 3 or 4`);
  }

  mkdirSync(outDir, { recursive: true });
  cpSync(gameDir, join(outDir, 'game'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

  // The scorer's own caps (reference/gate.json): only text_max_bytes shapes
  // the bytes; the others refuse an entry the scorer would refuse, so this
  // program fails in the same places instead of handing in bad output.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  return { shots, dossierBytes: Buffer.byteLength(dossier) };
}

const result = handIn();
console.log(`EMBERLINE handed in: ${result.shots} screenshots, dossier.json ${result.dossierBytes} bytes -> ${outDir}`);
