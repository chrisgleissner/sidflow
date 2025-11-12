import createLibsidplayfp from "./libsidplayfp.js";
// Only check environment variables in Node.js/server contexts, not in browsers/workers
const wasmPathOverride = (typeof process !== "undefined" && typeof process.env === "object")
    ? (process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH ?? process.env.LIBSIDPLAYFP_WASM_PATH)?.trim() || undefined
    : undefined;
// Detect if we're in a server-like environment (Node.js) vs browser/worker
const isServerLikeEnvironment = typeof globalThis === "object"
    ? (typeof globalThis.window === "undefined" && typeof process !== "undefined")
    : false;
const artifactBaseUrl = new URL("./", import.meta.url);
export async function loadLibsidplayfp(options = {}) {
    const locate = options.locateFile ?? ((asset) => {
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
export { SidAudioEngine } from "./player.js";
export default loadLibsidplayfp;
//# sourceMappingURL=index.js.map