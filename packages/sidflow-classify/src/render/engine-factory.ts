import loadLibsidplayfp, {
  SidAudioEngine,
} from "@sidflow/libsidplayfp-wasm";

import { createLogger, pathExists } from "@sidflow/common";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Cache the pre-compiled WebAssembly.Module.  A WebAssembly.Module contains
// only immutable compiled code with no mutable state — each WebAssembly.
// instantiate() from it gets a fresh WebAssembly.Instance with independent
// linear memory.  This skips both file I/O and WASM compilation on subsequent
// engine creations while keeping full memory isolation between engines.
let compiledWasmModulePromise: Promise<WebAssembly.Module> | null = null;

async function compileWasmModule(): Promise<WebAssembly.Module> {
  const pkgEntry = import.meta.resolve("@sidflow/libsidplayfp-wasm");
  const entryDir = path.dirname(fileURLToPath(pkgEntry));
  // import.meta.resolve may point to src/ (source) or dist/ depending on
  // whether we're running from TypeScript source or compiled output.
  const candidates = [
    path.join(entryDir, "libsidplayfp.wasm"),
    path.join(entryDir, "..", "dist", "libsidplayfp.wasm"),
  ];
  for (const wasmPath of candidates) {
    if (await pathExists(wasmPath)) {
      const bytes = await readFile(wasmPath);
      return WebAssembly.compile(bytes);
    }
  }
  throw new Error(`Could not find libsidplayfp.wasm; looked in: ${candidates.join(", ")}`);
}

export function getCompiledWasmModule(): Promise<WebAssembly.Module> {
  if (!compiledWasmModulePromise) {
    compiledWasmModulePromise = compileWasmModule();
  }
  return compiledWasmModulePromise;
}

/** Reset the cached compiled WASM module — used by tests. */
export function resetWasmModuleCache(): void {
  compiledWasmModulePromise = null;
}

export async function createEngine(): Promise<SidAudioEngine> {
  if (engineFactoryOverride) {
    return await engineFactoryOverride();
  }

  const compiledModule = await getCompiledWasmModule();

  // Load a fresh Emscripten module using instantiateWasm to inject the
  // pre-compiled WebAssembly.Module.  Each call creates a new Emscripten
  // instance with its own WebAssembly.Instance and linear memory, but
  // skips the expensive WASM compilation and file I/O.
  const wasmModule = await loadLibsidplayfp({
    instantiateWasm(
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance) => void
    ) {
      WebAssembly.instantiate(compiledModule, imports).then(
        (instance) => successCallback(instance),
        (error) => {
          logger.error("Failed to instantiate pre-compiled WASM module", { error });
          throw error;
        }
      );
      return {};
    },
  });

  const engine = new SidAudioEngine({
    module: Promise.resolve(wasmModule),
    sampleRate: 44100,
    stereo: true,
  });

  const roms = await getCachedSystemRoms();
  if (roms.kernal && roms.basic && roms.chargen) {
    await engine.setSystemROMs(roms.kernal, roms.basic, roms.chargen);
  }

  return engine;
}
