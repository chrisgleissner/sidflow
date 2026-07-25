import loadLibsidplayfp, {
  SidAudioEngine,
  type SidEngine,
} from "@sidflow/libsidplayfp-wasm";

import { createLogger, pathExists } from "@sidflow/common";
import { ensureSystemRoms } from "./system-roms-fetch.js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CreateEngineOptions {
  sampleRate?: number;
  stereo?: boolean;
  /** Defaults to CLASSIFY_DEFAULT_SID_ENGINE, or SIDFLOW_SID_ENGINE when set. */
  engine?: SidEngine;
}

/**
 * Classification defaults to SIDLite, not reSIDfp.
 *
 * reSIDfp is the reference and remains available, but it renders roughly an
 * order of magnitude slower, which is the difference between a corpus pass
 * measured in hours and one measured in most of a day. SIDLite was verified
 * against reSIDfp on real tunes once the mixer defects were fixed: clean,
 * unclipped, multi-SID included. Override per run with --sid-engine, or
 * globally with SIDFLOW_SID_ENGINE.
 */
export const CLASSIFY_DEFAULT_SID_ENGINE: SidEngine = "sidlite";

/**
 * Precedence: explicit argument, then SIDFLOW_SID_ENGINE, then SIDLite.
 *
 * Deliberately not resolveSidEngine() from the wasm package — that one falls
 * back to reSIDfp, which is right for a library consumer and wrong here.
 */
export function resolveClassifyEngine(engine?: SidEngine): SidEngine {
  if (engine) {
    return engine;
  }
  const fromEnv = process.env.SIDFLOW_SID_ENGINE?.trim().toLowerCase();
  if (fromEnv === "residfp" || fromEnv === "sidlite") {
    return fromEnv;
  }
  return CLASSIFY_DEFAULT_SID_ENGINE;
}

let engineFactoryOverride: ((options?: CreateEngineOptions) => Promise<SidAudioEngine>) | null = null;

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

  const found = await scanForSystemRoms();
  if (found) {
    return found;
  }

  // Deliberately no download here. This runs inside every render worker, so
  // fetching from here would mean N threads racing to write the same three
  // files, and would put a network call in the path of any unit test that
  // happens to build an engine. The classify CLI does it once up front instead
  // — see ensureSystemRomsForRun().
  logger.warn(
    "No system ROMs found for WASM renderer (looked in SIDFLOW_ROMS_DIR/SIDFLOW_ROM_DIR, SIDFLOW_ROOT/workspace/roms, workspace/roms, public/roms); continuing with built-in ROMs. " +
      "Tunes that need them will render as silence or a held frame and still classify, so treat this as a reason to stop."
  );
  return { kernal: null, basic: null, chargen: null };
}

/**
 * Make sure the C64 system ROMs are on disk before a classification run starts.
 *
 * Called once from the CLI, deliberately not from createEngine(): engines are
 * built inside parallel render workers, so downloading from there would race,
 * and would drag a network call into unit tests.
 */
export async function ensureSystemRomsForRun(): Promise<void> {
  if (process.env.SIDFLOW_WASM_DISABLE_ROMS === "1") {
    return;
  }
  if (await scanForSystemRoms()) {
    return;
  }
  const target = getSystemRomDirCandidates()[0];
  if (!target) {
    return;
  }
  const result = await ensureSystemRoms(target);
  if (result.status === "failed" || result.status === "skipped") {
    logger.warn("System ROMs are unavailable; rendering will be degraded", {
      reason: result.reason,
      dir: result.dir,
    });
  }
}

async function scanForSystemRoms(): Promise<SystemRoms | null> {
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

  return null;
}

async function getCachedSystemRoms(): Promise<SystemRoms> {
  if (!cachedSystemRomsPromise) {
    cachedSystemRomsPromise = loadSystemRoms();
  }
  return await cachedSystemRomsPromise;
}

export function setEngineFactoryOverride(
  override: ((options?: CreateEngineOptions) => Promise<SidAudioEngine>) | null
): void {
  engineFactoryOverride = override;
}

// Cache the pre-compiled WebAssembly.Module.  A WebAssembly.Module contains
// only immutable compiled code with no mutable state — each WebAssembly.
// instantiate() from it gets a fresh WebAssembly.Instance with independent
// linear memory.  This skips both file I/O and WASM compilation on subsequent
// engine creations while keeping full memory isolation between engines.
const compiledWasmModulePromises = new Map<SidEngine, Promise<WebAssembly.Module>>();

async function compileWasmModule(engine: SidEngine): Promise<WebAssembly.Module> {
  const pkgEntry = import.meta.resolve("@sidflow/libsidplayfp-wasm");
  const entryDir = path.dirname(fileURLToPath(pkgEntry));
  // SIDLite ships alongside the reference engine in dist/sidlite/.
  const suffix = engine === "sidlite" ? path.join("sidlite", "libsidplayfp.wasm") : "libsidplayfp.wasm";
  // import.meta.resolve may point to src/ (source) or dist/ depending on
  // whether we're running from TypeScript source or compiled output.
  const candidates = [
    path.join(entryDir, suffix),
    path.join(entryDir, "..", "dist", suffix),
  ];
  for (const wasmPath of candidates) {
    if (await pathExists(wasmPath)) {
      const bytes = await readFile(wasmPath);
      return WebAssembly.compile(bytes);
    }
  }
  throw new Error(
    `Could not find the ${engine} libsidplayfp.wasm; looked in: ${candidates.join(", ")}. ` +
      `Build it with \`SIDFLOW_SID_ENGINE=${engine} bun run build:wasm\`.`,
  );
}

export function getCompiledWasmModule(engine: SidEngine = CLASSIFY_DEFAULT_SID_ENGINE): Promise<WebAssembly.Module> {
  let cached = compiledWasmModulePromises.get(engine);
  if (!cached) {
    cached = compileWasmModule(engine);
    compiledWasmModulePromises.set(engine, cached);
  }
  return cached;
}

/** Reset the cached compiled WASM modules — used by tests. */
export function resetWasmModuleCache(): void {
  compiledWasmModulePromises.clear();
}

export async function createEngine(options: CreateEngineOptions = {}): Promise<SidAudioEngine> {
  if (engineFactoryOverride) {
    return await engineFactoryOverride(options);
  }

  const sidEngine = resolveClassifyEngine(options.engine);
  const compiledModule = await getCompiledWasmModule(sidEngine);

  // Load a fresh Emscripten module using instantiateWasm to inject the
  // pre-compiled WebAssembly.Module.  Each call creates a new Emscripten
  // instance with its own WebAssembly.Instance and linear memory, but
  // skips the expensive WASM compilation and file I/O.
  const wasmModule = await loadLibsidplayfp({
    engine: sidEngine,
    instantiateWasm(
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance) => void
    ) {
      WebAssembly.instantiate(compiledModule, imports).then(
        (result) => successCallback(result as unknown as WebAssembly.Instance),
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
    sampleRate:
      typeof options.sampleRate === "number" && Number.isFinite(options.sampleRate) && options.sampleRate > 0
        ? Math.floor(options.sampleRate)
        : 44100,
    stereo: options.stereo ?? true,
  });

  const roms = await getCachedSystemRoms();
  if (roms.kernal && roms.basic && roms.chargen) {
    await engine.setSystemROMs(roms.kernal, roms.basic, roms.chargen);
  }

  return engine;
}
