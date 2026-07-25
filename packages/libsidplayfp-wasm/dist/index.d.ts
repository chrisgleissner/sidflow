import { type LibsidplayfpWasmModule, type SidPlayerContextOptions } from "../dist/libsidplayfp.js";
/**
 * Which SID emulation to load.
 *
 * - `residfp` is cycle-accurate and is what a C64 actually sounds like. It is
 *   the reference, and the right choice when fidelity is the point.
 * - `sidlite` is an approximation that renders roughly an order of magnitude
 *   faster. It carries more DC than reSIDfp (measured 0.10 vs 0.003 on
 *   Commando) but is otherwise clean, and is fast enough to classify a corpus.
 *
 * Both are built from the same bindings and shipped side by side; see
 * SIDFLOW_SID_ENGINE in docker/entrypoint.sh.
 */
export type SidEngine = "residfp" | "sidlite";
/**
 * SIDLite is the default.
 *
 * It renders roughly an order of magnitude faster than reSIDfp and, once the
 * mixer defects were fixed, was verified against reSIDfp on real tunes: clean,
 * unclipped, multi-SID included. That makes it the right default for bulk work
 * such as classifying a corpus, which is what this package is mostly used for.
 *
 * Ask for `residfp` explicitly when fidelity is the point — it is the
 * cycle-accurate reference, and the remaining measurable gap is DC offset
 * (0.003 vs 0.10 on Commando).
 */
export declare const DEFAULT_SID_ENGINE: SidEngine;
export interface LoadLibsidplayfpOptions extends SidPlayerContextOptions {
    /**
     * Optional override for locating artifacts when bundlers relocate the WASM binary.
     * Defaults to the sibling dist/ directory.
     */
    locateFile?: SidPlayerContextOptions["locateFile"];
    /** Defaults to `residfp`, or SIDFLOW_SID_ENGINE when set. */
    engine?: SidEngine;
}
export declare function resolveSidEngine(engine?: SidEngine): SidEngine;
export declare function loadLibsidplayfp(options?: LoadLibsidplayfpOptions): Promise<LibsidplayfpWasmModule>;
export type { LibsidplayfpWasmModule, SidPlayerContext, SidPlayerContextOptions } from "../dist/libsidplayfp.js";
export { SidAudioEngine } from "./player.js";
export type { SidWriteTrace } from "./player.js";
export default loadLibsidplayfp;
//# sourceMappingURL=index.d.ts.map