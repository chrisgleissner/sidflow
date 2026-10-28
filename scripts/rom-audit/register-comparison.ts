/** Shared register-only predicate. Frame/window progress comes from actual PCM
 * or independently verified native sample-clock counts; never invented audio.
 */
export const REGISTER_RETAIN_WINDOWS = 12;
export class RegisterComparator {
  needsAudio = false;
  private readonly writes: number[][] = [[], []];
  private readonly positions = [0, 0];
  private offset: number | undefined;
  private densityStart: number | undefined;
  private densityWrites = 0;
  private densityVolumeWrites = 0;
  private readonly volumeCycles = new Map<number, number[]>();
  private pendingKey = "";
  private pendingWindow = 0;
  append(side: 0 | 1, writes: Float64Array): void {
    if (!this.needsAudio) for (const value of writes) this.writes[side]!.push(value);
  }
  complete(): boolean {
    return !this.needsAudio && this.positions.every((value, side) => value === this.writes[side]!.length);
  }
  clear(): void { this.writes[0] = []; this.writes[1] = []; this.positions[0] = this.positions[1] = 0; }
  compare(windows: number): void {
    const [a, b] = this.writes;
    let i = this.positions[0]!, j = this.positions[1]!;
    while (i < a!.length && j < b!.length) {
      const delta = b![j + 3]! - a![i + 3]!;
      this.offset ??= delta;
      if (a![i] !== b![j] || a![i + 1] !== b![j + 1] || a![i + 2] !== b![j + 2] ||
          Math.abs(this.offset) > 20000 || Math.abs(delta - this.offset) > 2000) { this.needsAudio = true; return; }
      i += 4; j += 4;
      // Millisecond tolerance is appropriate for musical control writes, but
      // can change sampled/digi audio. Dense streams must use audio spectra.
      this.densityStart ??= a![i - 1]!;
      this.densityWrites++;
      if ((a![i - 3]! & 31) === 24) {
        this.densityVolumeWrites++;
        const chip=a![i-4]!,cycles=this.volumeCycles.get(chip)??[];
        cycles.push(a![i-1]!);if(cycles.length>3)cycles.shift();this.volumeCycles.set(chip,cycles);
        // Three volume samples at >=1 kHz already identify a short digi burst;
        // do not need 100 writes before protecting a brief sampled effect.
        if(cycles.length===3&&cycles[2]!-cycles[0]!<=2000){this.needsAudio = true;return;}
      }
      // Check before resetting the window, including a burst at the very end
      // of a tune. Waiting for 100,000 cycles misses short sampled effects.
      if (this.densityWrites > 300 || this.densityVolumeWrites > 100) { this.needsAudio = true; return; }
      if (a![i - 1]! - this.densityStart >= 100000) {
        this.densityStart = a![i - 1]!; this.densityWrites = 0; this.densityVolumeWrites = 0;
      }
    }
    this.positions[0] = i; this.positions[1] = j;
    // A stalled/missing write stream cannot hide behind chunk boundaries. Keep
    // at most 256 ms of audio while waiting for its counterpart.
    const pendingKey = i < a!.length ? `a:${a![i + 3]}` : j < b!.length ? `b:${b![j + 3]}` : "";
    if (pendingKey !== this.pendingKey) { this.pendingKey = pendingKey; this.pendingWindow = windows; }
    if (pendingKey && windows - this.pendingWindow >= REGISTER_RETAIN_WINDOWS - 1) { this.needsAudio = true; return; }
    for (const side of [0, 1] as const) if (this.positions[side]! >= 4096) {
      this.writes[side] = this.writes[side]!.slice(this.positions[side]); this.positions[side] = 0;
    }
  }
}

/** Count-only counterpart of ListenerComparator's register path. It cannot
 * perform or report spectral comparisons. Any uncertainty requires real audio.
 */
export class RegisterClockComparator {
  private readonly register = new RegisterComparator();
  private readonly frames = [0, 0];
  private windows = 0;
  append(side: 0 | 1, frames: number, writes: Float64Array): void {
    if (!Number.isSafeInteger(frames) || frames < 0) throw new Error("Invalid measured frame count");
    this.frames[side]! += frames;
    this.register.append(side, writes);
  }
  compare(): void {
    if (!this.register.needsAudio) this.register.compare(this.windows);
    this.windows = Math.min(Math.floor(this.frames[0]! / 1024), Math.floor(this.frames[1]! / 1024));
  }
  finish(): { method: "register-equivalent" | "needs-audio"; windows: number } {
    const complete = this.register.complete();
    if (complete) this.register.compare(this.windows);
    return { method: complete && !this.register.needsAudio && this.frames[0] === this.frames[1] ? "register-equivalent" : "needs-audio",
      windows: Math.min(Math.ceil(this.frames[0]! / 1024), Math.ceil(this.frames[1]! / 1024)) };
  }
}
