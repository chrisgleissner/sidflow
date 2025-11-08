import createLibsidplayfp, {
  type LibsidplayfpWasmModule,
  type SidPlayerContext,
  type SidPlayerContextOptions,
} from '../dist/libsidplayfp.js';

export interface LoadLibsidplayfpOptions extends SidPlayerContextOptions {
  /**
   * Optional override for locating artifacts (useful when bundlers relocate the WASM binary).
   * Defaults to the relative dist/ folder that contains the generated module + wasm.
   */
  locateFile?: SidPlayerContextOptions['locateFile'];
}

const artifactBaseUrl = new URL('../dist/', import.meta.url);

export async function loadLibsidplayfp(
  options: LoadLibsidplayfpOptions = {}
): Promise<LibsidplayfpWasmModule> {
  const locate = options.locateFile
    ? options.locateFile
    : (path: string) => new URL(path, artifactBaseUrl).href;

  return createLibsidplayfp({
    ...options,
    locateFile: locate,
  });
}

export type {
  LibsidplayfpWasmModule,
  SidPlayerContext,
  SidPlayerContextOptions,
} from '../dist/libsidplayfp.js';

export { SidAudioEngine } from './player.js';

export default loadLibsidplayfp;
