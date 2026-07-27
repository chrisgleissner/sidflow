/**
 * Resource metrics for a classification run, sampled while it runs rather than after it
 * dies.
 *
 * A full HVSC pass has crashed with `RangeError: Out of memory` during WASM
 * instantiation three times at different points (31,626, 50,221 and 55,625 of 87,868
 * tracks). Everything known about it came from Bun's post-mortem crash report, which is
 * the worst possible time to learn something: one number, no history, and no way to tell
 * a leak from a spike.
 *
 * Peak RSS was 3.5 GB on a 62 GB machine, so plain RSS is not the signal. What might be:
 * how many WASM modules have been instantiated, how many engines are live versus
 * disposed, and how `external`/`arrayBuffers` move — WASM linear memory is allocated
 * outside the JS heap, so a leak there is invisible in `heapUsed`.
 *
 * This module records all of it continuously and reports a growth rate per thousand
 * songs, so an operator can see exhaustion approaching instead of discovering it
 * afterwards. It deliberately draws no conclusion about the cause: the mechanism is not
 * established, and the point of measuring is to stop guessing.
 */

export interface ClassifyResourceSnapshot {
  /** Resident set size in bytes. */
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  /** Memory held outside the JS heap. WASM linear memory lands here, not in heapUsed. */
  externalBytes: number;
  arrayBuffersBytes: number;
  /** WebAssembly.Module compilations. Should stay tiny: the module is meant to be cached. */
  wasmCompilations: number;
  /** WebAssembly instantiations. One per engine created, so this tracks engine churn. */
  wasmInstantiations: number;
  enginesCreated: number;
  enginesDisposed: number;
  /** Created minus disposed. A number that only rises is the shape of a leak. */
  enginesLive: number;
  /** Bytes of RSS growth since the run started. */
  rssGrowthBytes: number;
  /**
   * RSS growth per thousand songs processed. The headline leak indicator: a run that
   * holds steady reports near zero, and a run heading for exhaustion reports a positive
   * number that persists rather than decaying.
   */
  rssGrowthBytesPerThousandSongs: number | null;
  songsProcessed: number;
  elapsedMs: number;
}

interface MutableCounters {
  wasmCompilations: number;
  wasmInstantiations: number;
  enginesCreated: number;
  enginesDisposed: number;
}

const counters: MutableCounters = {
  wasmCompilations: 0,
  wasmInstantiations: 0,
  enginesCreated: 0,
  enginesDisposed: 0,
};

let baselineRssBytes: number | null = null;
let startedAtMs: number | null = null;

/**
 * Counters live for the process, but a run needs its growth measured from its own start,
 * not from whenever the module was first imported.
 */
export function beginResourceTracking(): void {
  baselineRssBytes = process.memoryUsage().rss;
  startedAtMs = Date.now();
  counters.wasmCompilations = 0;
  counters.wasmInstantiations = 0;
  counters.enginesCreated = 0;
  counters.enginesDisposed = 0;
}

export function recordWasmCompilation(): void {
  counters.wasmCompilations += 1;
}

export function recordWasmInstantiation(): void {
  counters.wasmInstantiations += 1;
}

export function recordEngineCreated(): void {
  counters.enginesCreated += 1;
}

export function recordEngineDisposed(): void {
  counters.enginesDisposed += 1;
}

export function snapshotResourceMetrics(songsProcessed: number): ClassifyResourceSnapshot {
  const usage = process.memoryUsage();
  const baseline = baselineRssBytes ?? usage.rss;
  const growth = usage.rss - baseline;
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external ?? 0,
    arrayBuffersBytes: usage.arrayBuffers ?? 0,
    wasmCompilations: counters.wasmCompilations,
    wasmInstantiations: counters.wasmInstantiations,
    enginesCreated: counters.enginesCreated,
    enginesDisposed: counters.enginesDisposed,
    enginesLive: counters.enginesCreated - counters.enginesDisposed,
    rssGrowthBytes: growth,
    rssGrowthBytesPerThousandSongs: songsProcessed > 0 ? (growth / songsProcessed) * 1000 : null,
    songsProcessed,
    elapsedMs: startedAtMs === null ? 0 : Date.now() - startedAtMs,
  };
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)}Mi`;
}

/** One compact line, because it goes into a progress log that already has a lot in it. */
export function formatResourceMetrics(snapshot: ClassifyResourceSnapshot): string {
  const perThousand = snapshot.rssGrowthBytesPerThousandSongs === null
    ? "n/a"
    : `${(snapshot.rssGrowthBytesPerThousandSongs / (1024 * 1024)).toFixed(1)}Mi/1k`;
  return `rss=${mib(snapshot.rssBytes)} heap=${mib(snapshot.heapUsedBytes)}`
    + ` external=${mib(snapshot.externalBytes)} arrayBuffers=${mib(snapshot.arrayBuffersBytes)}`
    + ` wasmInst=${snapshot.wasmInstantiations} wasmComp=${snapshot.wasmCompilations}`
    + ` enginesLive=${snapshot.enginesLive}/${snapshot.enginesCreated}`
    + ` rssGrowth=${mib(snapshot.rssGrowthBytes)} (${perThousand})`;
}

/**
 * Thresholds are deliberately generous. The crash arrived at 3.5 GB on a 62 GB machine,
 * so any threshold tight enough to predict it would fire constantly on a healthy run;
 * these exist to catch the unambiguous cases and to make the numbers visible, not to
 * pretend the failure is understood.
 */
const RSS_WARN_BYTES = 8 * 1024 * 1024 * 1024;
const ENGINES_LIVE_WARN = 64;
const GROWTH_WARN_BYTES_PER_THOUSAND = 256 * 1024 * 1024;

export function resourceWarnings(snapshot: ClassifyResourceSnapshot): string[] {
  const warnings: string[] = [];
  if (snapshot.rssBytes > RSS_WARN_BYTES) {
    warnings.push(`RSS ${mib(snapshot.rssBytes)} exceeds ${mib(RSS_WARN_BYTES)}`);
  }
  if (snapshot.enginesLive > ENGINES_LIVE_WARN) {
    warnings.push(
      `${snapshot.enginesLive} render engines live (created ${snapshot.enginesCreated},`
      + ` disposed ${snapshot.enginesDisposed}); engines are pooled, so this should stay near the thread count`,
    );
  }
  if (
    snapshot.songsProcessed >= 2000
    && snapshot.rssGrowthBytesPerThousandSongs !== null
    && snapshot.rssGrowthBytesPerThousandSongs > GROWTH_WARN_BYTES_PER_THOUSAND
  ) {
    warnings.push(
      `RSS growing ${(snapshot.rssGrowthBytesPerThousandSongs / (1024 * 1024)).toFixed(0)}Mi per 1000 songs,`
      + ` which will not survive a full corpus`,
    );
  }
  return warnings;
}
