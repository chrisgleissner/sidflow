import { type LibsidplayfpWasmModule, type SidPlayerContextOptions } from "../dist/libsidplayfp.js";
export interface LoadLibsidplayfpOptions extends SidPlayerContextOptions {
    /**
     * Optional override for locating artifacts when bundlers relocate the WASM binary.
     * Defaults to the sibling dist/ directory.
     */
    locateFile?: SidPlayerContextOptions["locateFile"];
}
export declare function loadLibsidplayfp(options?: LoadLibsidplayfpOptions): Promise<LibsidplayfpWasmModule>;
export type { LibsidplayfpWasmModule, SidPlayerContext, SidPlayerContextOptions } from "../dist/libsidplayfp.js";
export { SidAudioEngine } from "./player.js";
export default loadLibsidplayfp;
//# sourceMappingURL=index.d.ts.map