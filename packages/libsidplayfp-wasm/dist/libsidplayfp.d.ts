export interface SidPlayerContextOptions {
  locateFile?(path: string, prefix?: string): string | URL;
  [key: string]: unknown;
}

export type SidTuneInfo = Record<string, unknown> | null;
export type EngineInfo = Record<string, unknown> | null;

export class SidPlayerContext {
  constructor();
  configure(sampleRate: number, stereo: boolean): boolean;
  loadSidBuffer(buffer: Uint8Array | ArrayBufferView): boolean;
  loadSidFile(path: string): boolean;
  selectSong(song: number): number;
  render(cycles: number): Int16Array | null;
  reset(): boolean;
  hasTune(): boolean;
  isStereo(): boolean;
  getChannels(): number;
  getSampleRate(): number;
  getTuneInfo(): SidTuneInfo;
  getEngineInfo(): EngineInfo;
  getLastError(): string;
  setSystemROMs(
    kernal?: Uint8Array | ArrayBufferView | null,
    basic?: Uint8Array | ArrayBufferView | null,
    chargen?: Uint8Array | ArrayBufferView | null
  ): boolean;
}

export interface LibsidplayfpWasmModule {
  FS: any;
  PATH: any;
  SidPlayerContext: typeof SidPlayerContext;
  sidflowSelectSong?: (ctx: SidPlayerContext, song: number) => number;
}

export default function createLibsidplayfp(moduleConfig?: SidPlayerContextOptions): Promise<LibsidplayfpWasmModule>;
