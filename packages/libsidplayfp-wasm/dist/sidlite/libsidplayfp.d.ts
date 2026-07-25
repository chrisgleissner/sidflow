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
  /**
   * Supply the C64 system ROMs. Without them libsidplayfp initialises a tune
   * but never advances it. Sizes are exact: KERNAL 8192, BASIC 8192,
   * CHARGEN 4096 bytes. Pass nulls to clear.
   */
  setSystemROMs(
    kernal?: Uint8Array | ArrayBufferView | null,
    basic?: Uint8Array | ArrayBufferView | null,
    chargen?: Uint8Array | ArrayBufferView | null
  ): boolean;
  /** Record every SID register write during render(). */
  setSidWriteTraceEnabled(enabled: boolean): void;
  getAndClearSidWriteTraces(): Array<{
    sidNumber: number;
    address: number;
    value: number;
    cyclePhi1: number;
  }>;
  /** Release the C++ object. Embind handles are not garbage collected. */
  delete(): void;
}

export interface LibsidplayfpWasmModule {
  FS: any;
  PATH: any;
  SidPlayerContext: typeof SidPlayerContext;
  /** Builder baked into this artifact: "WasmReSIDfp" or "WasmSIDLite". */
  getSidEngineName(): string;
}

export default function createLibsidplayfp(moduleConfig?: SidPlayerContextOptions): Promise<LibsidplayfpWasmModule>;
