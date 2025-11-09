import createLibsidplayfp, {
    type LibsidplayfpWasmModule,
    type SidPlayerContext,
    type SidPlayerContextOptions
} from "../dist/libsidplayfp.js";

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
    const locate = options.locateFile ?? ((asset: string) => new URL(asset, artifactBaseUrl).href);

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
