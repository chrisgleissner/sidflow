import { type SidPlayerContextOptions, type SidPlayerContext } from "../dist/libsidplayfp.js";
export interface LoadLibsidplayfpOptions extends SidPlayerContextOptions {
    /**
     * Optional override for locating artifacts when bundlers relocate the WASM binary.
     * Defaults to the sibling dist/ directory.
     */
    locateFile?: SidPlayerContextOptions["locateFile"];
}

// Re-export the interface directly to help Next.js module resolution
export interface LibsidplayfpWasmModule {
  FS: any;
  PATH: any;
  SidPlayerContext: typeof SidPlayerContext;
}

export declare function loadLibsidplayfp(options?: LoadLibsidplayfpOptions): Promise<LibsidplayfpWasmModule>;
export type { SidPlayerContext, SidPlayerContextOptions } from "../dist/libsidplayfp.js";
export { SidAudioEngine } from "./player.js";
export default loadLibsidplayfp;
