import loadLibsidplayfp, {
  SidAudioEngine,
  type LibsidplayfpWasmModule
} from "@sidflow/libsidplayfp-wasm";

import { createLogger, pathExists } from "@sidflow/common";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

let engineFactoryOverride: (() => Promise<SidAudioEngine>) | null = null;

const logger = createLogger("wasm-engine-factory");

interface SystemRoms {
  kernal: Uint8Array | null;
  basic: Uint8Array | null;
  chargen: Uint8Array | null;
  sourceDir?: string;
}

let cachedSystemRomsPromise: Promise<SystemRoms> | null = null;

function getSystemRomDirCandidates(): string[] {
  const candidates: Array<string | undefined> = [
    process.env.SIDFLOW_ROMS_DIR,
    process.env.SIDFLOW_ROM_DIR,
    process.env.SIDFLOW_ROOT ? path.join(process.env.SIDFLOW_ROOT, "workspace", "roms") : undefined,
    path.join(process.cwd(), "workspace", "roms"),
    path.join(process.cwd(), "public", "roms"),
  ];
  return candidates.filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function findRomFile(dir: string, preferredNames: string[], patterns: RegExp[]): Promise<string | null> {
  for (const name of preferredNames) {
    const candidate = path.join(dir, name);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const normalized = entry.toLowerCase();
    if (!normalized.endsWith(".bin") && !normalized.endsWith(".rom")) {
      continue;
    }
    if (patterns.some((pattern) => pattern.test(entry))) {
      return path.join(dir, entry);
    }
  }

  return null;
}

async function loadSystemRoms(): Promise<SystemRoms> {
  if (process.env.SIDFLOW_WASM_DISABLE_ROMS === "1") {
    return { kernal: null, basic: null, chargen: null };
  }

  for (const dir of getSystemRomDirCandidates()) {
    if (!(await pathExists(dir))) {
      continue;
    }

    const kernalPath = await findRomFile(
      dir,
      ["kernal.901227-03.bin", "kernal.bin", "kernal.rom"],
      [/^kernal\./i, /^kernal/i]
    );
    const basicPath = await findRomFile(
      dir,
      ["basic.901226-01.bin", "basic.bin", "basic.rom"],
      [/^basic\./i, /^basic/i]
    );
    const chargenPath = await findRomFile(
      dir,
      ["characters.901225-01.bin", "chargen.bin", "chargen.rom", "characters.bin", "characters.rom"],
      [/^chargen\./i, /^chargen/i, /^characters\./i, /^characters/i]
    );

    if (!kernalPath || !basicPath || !chargenPath) {
      logger.warn("System ROMs directory found, but required ROMs are missing; continuing without ROM injection", {
        dir,
        kernalPath: kernalPath ?? null,
        basicPath: basicPath ?? null,
        chargenPath: chargenPath ?? null,
      });
      continue;
    }

    const [kernal, basic, chargen] = await Promise.all([
      readFile(kernalPath).then((buf) => new Uint8Array(buf)),
      readFile(basicPath).then((buf) => new Uint8Array(buf)),
      readFile(chargenPath).then((buf) => new Uint8Array(buf)),
    ]);

    logger.info("Loaded system ROMs for WASM renderer", {
      dir,
      kernal: path.basename(kernalPath),
      basic: path.basename(basicPath),
      chargen: path.basename(chargenPath),
    });

    return {
      kernal,
      basic,
      chargen,
      sourceDir: dir,
    };
  }

  logger.warn(
    "No system ROMs found for WASM renderer (looked in SIDFLOW_ROMS_DIR/SIDFLOW_ROM_DIR, SIDFLOW_ROOT/workspace/roms, workspace/roms, public/roms); continuing with built-in ROMs"
  );
  return { kernal: null, basic: null, chargen: null };
}

async function getCachedSystemRoms(): Promise<SystemRoms> {
  if (!cachedSystemRomsPromise) {
    cachedSystemRomsPromise = loadSystemRoms();
  }
  return await cachedSystemRomsPromise;
}

export function setEngineFactoryOverride(
  override: (() => Promise<SidAudioEngine>) | null
): void {
  engineFactoryOverride = override;
}

export async function getWasmModule(): Promise<LibsidplayfpWasmModule> {
  // NEVER cache - always load a fresh WASM module to ensure complete isolation
  const module = await loadLibsidplayfp();
  return module;
}

export async function createEngine(): Promise<SidAudioEngine> {
  if (engineFactoryOverride) {
    return await engineFactoryOverride();
  }
  const module = await getWasmModule();
  
  // Create engine with explicit configuration and fresh module
  const engine = new SidAudioEngine({ 
    module: Promise.resolve(module),
    sampleRate: 44100,
    stereo: true
  });

  const roms = await getCachedSystemRoms();
  if (roms.kernal && roms.basic && roms.chargen) {
    await engine.setSystemROMs(roms.kernal, roms.basic, roms.chargen);
  }
  
  return engine;
}
