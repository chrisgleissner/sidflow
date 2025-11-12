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

export interface LoadLibsidplayfpOptions extends SidPlayerContextOptions {
    /**
     * Optional override for locating artifacts when bundlers relocate the WASM binary.
     * Defaults to the sibling dist/ directory.
     */
    locateFile?: SidPlayerContextOptions["locateFile"];
}

const artifactBaseUrl = new URL("../dist/", import.meta.url);

export async function loadLibsidplayfp(
    options: LoadLibsidplayfpOptions = {}
): Promise<LibsidplayfpWasmModule> {
    const locate = options.locateFile ?? ((asset: string) => {
        if (isServerLikeEnvironment && wasmPathOverride) {
            return wasmPathOverride;
        }
        return new URL(asset, artifactBaseUrl).href;
    });

    return await createLibsidplayfp({
        ...options,
        locateFile: locate
    });
}

export type {
    LibsidplayfpWasmModule,
    SidPlayerContext,
    SidPlayerContextOptions
} from "../dist/libsidplayfp.js";

export { SidAudioEngine } from "./player.js";

export default loadLibsidplayfp;
