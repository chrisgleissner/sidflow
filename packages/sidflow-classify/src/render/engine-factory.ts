import loadLibsidplayfp, {
  SidAudioEngine,
  type LibsidplayfpWasmModule
} from "@sidflow/libsidplayfp-wasm";

let engineFactoryOverride: (() => Promise<SidAudioEngine>) | null = null;

export function setEngineFactoryOverride(
  override: (() => Promise<SidAudioEngine>) | null
): void {
  engineFactoryOverride = override;
}

export async function getWasmModule(): Promise<LibsidplayfpWasmModule> {
  // NEVER cache - always load a fresh WASM module to ensure complete isolation
  const module = await loadLibsidplayfp();
  return module;
}

export async function createEngine(): Promise<SidAudioEngine> {
  if (engineFactoryOverride) {
    return await engineFactoryOverride();
  }
  const module = await getWasmModule();
  
  // Create engine with explicit configuration and fresh module
  const engine = new SidAudioEngine({ 
    module: Promise.resolve(module),
    sampleRate: 44100,
    stereo: true
  });
  
  return engine;
}
