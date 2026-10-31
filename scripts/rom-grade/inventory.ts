/** HVSC inventory for grading: per-subtune horizon, file kind and header-derived context.
 * Cached as JSON (deterministic) because hashing 61,157 files takes a minute. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { releaseLengths } from "../rom-audit/inputs.js";
import { observationHorizon } from "../rom-audit/methodology.js";
import { nativePaths } from "./native.js";
import { sidInfo, type SidInfo } from "./sid-info.js";

export interface InventorySong { song: number; seconds: number; documented: boolean }
export interface InventoryTune extends SidInfo { path: string; sha256: string; md5: string; songsList: InventorySong[] }
export interface Inventory { tunes: InventoryTune[] }

export function inventoryCachePath(): string { return path.join(nativePaths().output, "inventory.json"); }

export async function buildInventory(hvscRoot = nativePaths().hvsc, concurrency = 8): Promise<Inventory> {
  const lengths = releaseLengths(await readFile(path.join(hvscRoot, "DOCUMENTS/Songlengths.md5"), "utf8"));
  const files = (await readdir(hvscRoot, { recursive: true, withFileTypes: true }))
    .filter(f => f.isFile() && f.name.toLowerCase().endsWith(".sid"))
    .map(f => path.relative(hvscRoot, path.join(f.parentPath, f.name))).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const tunes: InventoryTune[] = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let i = next++; i < files.length; i = next++) {
      const relative = files[i]!, bytes = await readFile(path.join(hvscRoot, relative)), entry = lengths.get(relative);
      if (!entry) throw new Error(`No Songlengths entry for ${relative}`);
      const info = sidInfo(bytes);
      // One duration token per subtune the header declares; a short entry would silently drop subtunes from the scope.
      if (entry.tokens.length !== info.songs) throw new Error(`Songlengths entry for ${relative} has ${entry.tokens.length} durations, the SID header declares ${info.songs} subtunes`);
      tunes[i] = {
        ...info, path: relative, sha256: createHash("sha256").update(bytes).digest("hex"), md5: createHash("md5").update(bytes).digest("hex"),
        songsList: entry.tokens.map((token, index) => {
          const horizon = observationHorizon(token, 10);
          return { song: index + 1, seconds: horizon.seconds, documented: horizon.documentedSeconds !== null };
        }),
      };
    }
  }));
  return { tunes };
}

export async function loadInventory(): Promise<Inventory> {
  const cache = inventoryCachePath();
  if (existsSync(cache)) return JSON.parse(await readFile(cache, "utf8")) as Inventory;
  const inventory = await buildInventory();
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, stringifyDeterministic(inventory as unknown as JsonValue, 0));
  return inventory;
}

export type HorizonBand = "<30s" | "30-120s" | "120-300s" | ">300s" | "fallback-300s";
/** Horizon bands of the design; the 300 s fallback (no documented length) is its own band. */
export function horizonBand(seconds: number, documented: boolean): HorizonBand {
  if (!documented) return "fallback-300s";
  return seconds <= 30 ? "<30s" : seconds <= 120 ? "30-120s" : seconds <= 300 ? "120-300s" : ">300s";
}
