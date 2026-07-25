import createLibsidplayfp, {
    type LibsidplayfpWasmModule,
    type SidPlayerContext,
    type SidPlayerContextOptions
} from "../dist/libsidplayfp.js";

// Only check environment variables in Node.js/server contexts, not in browsers/workers
const wasmPathOverride = (typeof process !== "undefined" && typeof process.env === "object")
    ? (process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH ?? process.env.LIBSIDPLAYFP_WASM_PATH)?.trim() || undefined
    : undefined;

// Detect if we're in a server-like environment (Node.js) vs browser/worker
const isServerLikeEnvironment = typeof globalThis === "object"
    ? (typeof (globalThis as { window?: unknown }).window === "undefined" && typeof process !== "undefined")
    : false;

/**
 * Which SID emulation to load. Both are built from the same bindings and
 * shipped side by side — `dist/` is reSIDfp, `dist/sidlite/` is SIDLite. See
 * SIDFLOW_SID_ENGINE in docker/entrypoint.sh for how they are produced.
 */
export type SidEngine = "residfp" | "sidlite";

/**
 * SIDLite is the default: it sounds good and renders roughly an order of
 * magnitude faster, which is what bulk work such as classifying a corpus needs.
 * Once the mixer defects were fixed it was verified against reSIDfp on real
 * tunes — clean, unclipped, multi-SID included — and most listeners will not
 * hear the difference.
 *
 * Ask for `residfp` explicitly when the last few percent of fidelity is the
 * point. It is the cycle-accurate reference, and the remaining measurable gap
 * is DC offset: 0.003 against SIDLite's 0.10 on Commando.
 */
export const DEFAULT_SID_ENGINE: SidEngine = "sidlite";

export interface LoadLibsidplayfpOptions extends SidPlayerContextOptions {
    /**
     * Optional override for locating artifacts when bundlers relocate the WASM binary.
     * Defaults to the sibling dist/ directory.
     */
    locateFile?: SidPlayerContextOptions["locateFile"];

    /** Precedence: this value, then SIDFLOW_SID_ENGINE, then DEFAULT_SID_ENGINE. */
    engine?: SidEngine;
}

const artifactBaseUrl = new URL("../dist/", import.meta.url);
const sidliteArtifactBaseUrl = new URL("../dist/sidlite/", import.meta.url);

function envEngine(): SidEngine | undefined {
    if (typeof process === "undefined" || typeof process.env !== "object") {
        return undefined;
    }
    const raw = process.env.SIDFLOW_SID_ENGINE?.trim().toLowerCase();
    return raw === "residfp" || raw === "sidlite" ? raw : undefined;
}

export function resolveSidEngine(engine?: SidEngine): SidEngine {
    return engine ?? envEngine() ?? DEFAULT_SID_ENGINE;
}

const cachedDefaultModulePromises = new Map<SidEngine, Promise<LibsidplayfpWasmModule>>();

async function createModulePromise(
    options: LoadLibsidplayfpOptions
): Promise<LibsidplayfpWasmModule> {
    const engine = resolveSidEngine(options.engine);
    const baseUrl = engine === "sidlite" ? sidliteArtifactBaseUrl : artifactBaseUrl;

    const locate = options.locateFile ?? ((asset: string) => {
        // The path override names one specific binary, so it can only apply to
        // the engine the caller actually asked for.
        if (isServerLikeEnvironment && wasmPathOverride) {
            return wasmPathOverride;
        }
        return new URL(asset, baseUrl).href;
    });

    // reSIDfp keeps the static import so bundlers can see it. SIDLite is loaded
    // dynamically: it is the secondary artifact and must not become a hard
    // dependency of every bundle that only ever wants the reference engine.
    const factory = engine === "sidlite"
        ? (await import("../dist/sidlite/libsidplayfp.js")).default
        : createLibsidplayfp;

    const { engine: _engine, ...moduleOptions } = options;
    return await factory({
        ...moduleOptions,
        locateFile: locate
    });
}

function isCacheableDefaultLoad(options: LoadLibsidplayfpOptions): boolean {
    const keys = Object.keys(options);
    return keys.length === 0 || (keys.length === 1 && keys[0] === "engine");
}

export async function loadLibsidplayfp(
    options: LoadLibsidplayfpOptions = {}
): Promise<LibsidplayfpWasmModule> {
    if (isCacheableDefaultLoad(options)) {
        const engine = resolveSidEngine(options.engine);
        let cached = cachedDefaultModulePromises.get(engine);
        if (!cached) {
            cached = createModulePromise(options).catch((error) => {
                cachedDefaultModulePromises.delete(engine);
                throw error;
            });
            cachedDefaultModulePromises.set(engine, cached);
        }
        return await cached;
    }

    return await createModulePromise(options);
}

export type {
    LibsidplayfpWasmModule,
    SidPlayerContext,
    SidPlayerContextOptions
} from "../dist/libsidplayfp.js";

export { SidAudioEngine } from "./player.js";
export type { SidWriteTrace } from "./player.js";

export default loadLibsidplayfp;
