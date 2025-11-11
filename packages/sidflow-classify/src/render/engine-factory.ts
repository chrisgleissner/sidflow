import loadLibsidplayfp, {
  SidAudioEngine,
  type LibsidplayfpWasmModule
} from "@sidflow/libsidplayfp-wasm";

let wasmModulePromise: Promise<LibsidplayfpWasmModule> | null = null;
let engineFactoryOverride: (() => Promise<SidAudioEngine>) | null = null;

export function setEngineFactoryOverride(
  override: (() => Promise<SidAudioEngine>) | null
): void {
  engineFactoryOverride = override;
}

export async function getWasmModule(): Promise<LibsidplayfpWasmModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = loadLibsidplayfp();
  }
  return wasmModulePromise;
}

export async function createEngine(): Promise<SidAudioEngine> {
  if (engineFactoryOverride) {
    return await engineFactoryOverride();
  }
  const module = await getWasmModule();
  return new SidAudioEngine({ module: Promise.resolve(module) });
}
