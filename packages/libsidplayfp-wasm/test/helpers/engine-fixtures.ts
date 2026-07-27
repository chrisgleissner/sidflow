/**
 * Fixture set and render loop shared by the engine gate and the native
 * comparison, so both drive the engine identically. Any divergence here would
 * make the CI gate and the formal analysis measure different things.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHANNELS, SAMPLE_RATE } from "../../scripts/engine-metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

export const RENDER_SECONDS = 4;

/**
 * The host default. `Player::play()` clamps to MAX_CYCLES (20 000) internally,
 * so this is "as much as the engine will give per call".
 */
export const CHUNK_CYCLES = 100000;

/**
 * Committed SID files chosen to cover the paths that actually broke. The
 * multi-SID tunes matter: every buffer defect this package has had lived in the
 * per-chip buffer bookkeeping, which a single-SID tune exercises only trivially.
 */
export const FIXTURES = [
  { name: "test-tone-c4", file: path.join(PACKAGE_ROOT, "test-tone-c4.sid") },
  { name: "10_Orbyte", file: path.join(REPO_ROOT, "test-data/C64Music/DEMOS/0-9/10_Orbyte.sid") },
  { name: "Ta-Boo", file: path.join(REPO_ROOT, "test-data/C64Music/MUSICIANS/N/Ninja/Ta-Boo.sid") },
  {
    name: "Space_Oddity_2SID",
    file: path.join(REPO_ROOT, "test-data/C64Music/MUSICIANS/C/C0zmo/Space_Oddity_2SID.sid"),
  },
  {
    name: "Waterfall_3SID",
    file: path.join(REPO_ROOT, "test-data/C64Music/MUSICIANS/C/Chiummo_Gaetano/Waterfall_3SID.sid"),
  },
] as const;

/**
 * Render a tune the way a host does: configure, load, select the song, then pull
 * fixed-size chunks.
 *
 * Deliberately **no C64 ROMs**. CI cannot ship ROM images, and none are needed:
 * every property under test is about self-consistency against a golden taken the
 * same way, not musical accuracy. (Without ROMs libsidplayfp initialises a tune
 * but never advances it — the output is still a deterministic function of the
 * engine, and all three historical defects still show up in it.)
 */
export function renderWith(
  wasmModule: { SidPlayerContext: new () => any },
  file: string,
  chunkCycles: number = CHUNK_CYCLES,
  seconds: number = RENDER_SECONDS,
): Int16Array {
  const context = new wasmModule.SidPlayerContext();
  try {
    if (!context.configure(SAMPLE_RATE, CHANNELS === 2)) {
      throw new Error(`configure failed: ${context.getLastError()}`);
    }
    if (!context.loadSidBuffer(new Uint8Array(readFileSync(file)))) {
      throw new Error(`loadSidBuffer failed: ${context.getLastError()}`);
    }
    context.selectSong(0);

    const wanted = seconds * SAMPLE_RATE * CHANNELS;
    const out = new Int16Array(wanted);
    let have = 0;
    let empties = 0;

    while (have < wanted) {
      const chunk = context.render(chunkCycles);
      if (!chunk || chunk.length === 0) {
        if (++empties > 64) break;
        continue;
      }
      empties = 0;
      const take = Math.min(chunk.length, wanted - have);
      out.set(chunk.subarray(0, take), have);
      have += take;
    }

    return out.subarray(0, have);
  } finally {
    // embind objects are not garbage collected: without delete() the C++
    // SidPlayerContext lives on, keeping its SID emulations locked in the shared
    // module and shifting the allocation pattern seen by later renders.
    context.delete();
  }
}
