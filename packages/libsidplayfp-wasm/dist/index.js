import createLibsidplayfp from "../dist/libsidplayfp.js";
const wasmPathOverride = typeof process !== "undefined"
    ? (process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH ?? process.env.LIBSIDPLAYFP_WASM_PATH)?.trim() || undefined
    : undefined;
const isServerLikeEnvironment = typeof globalThis === "object"
    ? typeof globalThis.window === "undefined"
    : true;
const artifactBaseUrl = new URL("../dist/", import.meta.url);
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