/**
 * Measure what a listener gets: how many distinct tunes a station serves before it runs out.
 *
 * This is the only measurement in this repository that reports on the product rather than on
 * the artefact, and it is the one that caught the 0.8.2 outcome — a bundle whose reachable
 * stream grew from 17 tracks to 43,934 while the station it fed still served about a thousand.
 * It needs no HVSC, no audio and no device.
 *
 * ## The policies it compares
 *
 * - **fixed** — what the client ships today: `computeStation` called repeatedly with the same
 *   seed and a growing exclusion set. The reachable region is a ball of radius
 *   `EXTENDED_MAX_HOPS` around a point that never moves, so the station's length depends on the
 *   branching factor rather than on how far the graph goes.
 * - **drift** — the proposed policy: the last *N* consumed ordinals become extra seeds with
 *   recency-decaying weight, so the retrieval centre moves with the listener.
 * - `--dedupe-tune` excludes a consumed track's whole `.sid` file rather than just that subsong,
 *   which is what stops a station playing one tune three times in a row.
 *
 * ## Usage
 *
 *   node scripts/run-bun.mjs run scripts/neighbour-graph/simulate-station.ts \
 *     --tiny tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr \
 *     --seeds 300 --policy fixed
 *
 * Flags:
 *   --policy fixed|drift    seeding policy (default fixed)
 *   --recent N              drift window, in consumed tracks (default 5)
 *   --recent-weight W       weight of the most recent track (default 1.0)
 *   --recent-decay D        geometric decay per step back (default 0.6)
 *   --origin-weight W       weight retained by the original seed under drift (default 0.3)
 *   --dedupe-tune           exclude every subsong of a consumed file
 *   --max-hops N            override EXTENDED_MAX_HOPS
 *   --seeds N               station sample size (default 300)
 *   --kind song|style       station kind (default song)
 *   --style-bit N           style bit for --kind style
 *   --cap N                 stop a station after N distinct tracks (default 60000)
 *   --json PATH             write the measurements as JSON
 */

import { writeFileSync } from "node:fs";
import { decodeTinyNeighbourGraph } from "../../packages/sidflow-common/src/index.js";
import { createRandom } from "./full-export.js";
import { buildStationBundle, type StationSeed } from "./station-engine-port.js";
import { formatSummary, runStation, summarise, type StationRun } from "./station-metrics.js";

interface Options {
  tiny: string;
  policy: "fixed" | "drift";
  recent: number;
  recentWeight: number;
  recentDecay: number;
  originWeight: number;
  dedupeTune: boolean;
  maxHops?: number;
  seeds: number;
  kind: "song" | "style";
  styleBit: number;
  cap: number;
  json?: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    tiny: "",
    policy: "fixed",
    recent: 5,
    recentWeight: 1,
    recentDecay: 0.6,
    originWeight: 0.3,
    dedupeTune: false,
    seeds: 300,
    kind: "song",
    styleBit: 0,
    cap: 60_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const next = argv[index + 1];
    switch (argument) {
      case "--tiny":
        options.tiny = next ?? "";
        index += 1;
        break;
      case "--policy":
        if (next !== "fixed" && next !== "drift") {
          throw new Error(`--policy must be fixed or drift, got ${String(next)}`);
        }
        options.policy = next;
        index += 1;
        break;
      case "--recent":
        options.recent = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--recent-weight":
        options.recentWeight = Number.parseFloat(next ?? "");
        index += 1;
        break;
      case "--recent-decay":
        options.recentDecay = Number.parseFloat(next ?? "");
        index += 1;
        break;
      case "--origin-weight":
        options.originWeight = Number.parseFloat(next ?? "");
        index += 1;
        break;
      case "--dedupe-tune":
        options.dedupeTune = true;
        break;
      case "--max-hops":
        options.maxHops = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--seeds":
        options.seeds = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--kind":
        if (next !== "song" && next !== "style") {
          throw new Error(`--kind must be song or style, got ${String(next)}`);
        }
        options.kind = next;
        index += 1;
        break;
      case "--style-bit":
        options.styleBit = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--cap":
        options.cap = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--json":
        options.json = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.tiny) {
    throw new Error("--tiny is required");
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const decoded = await decodeTinyNeighbourGraph(options.tiny);
  const bundle = buildStationBundle({
    trackCount: decoded.trackCount,
    neighborsPerTrack: decoded.neighborsPerTrack,
    targets: decoded.targets,
    fileOrdinalByTrack: decoded.fileOrdinalByTrack,
    styleMaskByTrack: decoded.styleMaskByTrack,
  });
  process.stdout.write(
    `${options.tiny}: ${bundle.trackCount} tracks over ${bundle.fileTrackCount.length} files\n\n`,
  );

  // A fixed PRNG stream, so two policies are compared over the same stations.
  const random = createRandom(20_260_730);
  const runs: StationRun[] = [];
  for (let index = 0; index < options.seeds; index += 1) {
    const shuffleSeed = Math.floor(random() * 0x7f_ff_ff_ff);
    const seed: StationSeed = options.kind === "song"
      ? { kind: "song", fileOrdinal: Math.floor(random() * bundle.fileTrackCount.length) }
      : { kind: "style", styleBit: options.styleBit };
    runs.push(runStation(bundle, seed, shuffleSeed, {
      policy: options.policy,
      recent: options.recent,
      recentWeight: options.recentWeight,
      recentDecay: options.recentDecay,
      originWeight: options.originWeight,
      dedupeTune: options.dedupeTune,
      maxHops: options.maxHops,
      cap: options.cap,
    }));
  }

  const label = `${options.kind} station, policy ${options.policy}`
    + (options.policy === "drift"
      ? `, recent ${options.recent} @ w${options.recentWeight} d${options.recentDecay}, origin ${options.originWeight}`
      : "")
    + (options.dedupeTune ? ", tune-level dedupe" : "")
    + (options.maxHops === undefined ? "" : `, maxHops ${options.maxHops}`);
  const summary = summarise(label, runs);
  process.stdout.write(`${formatSummary(summary)}\n`);
  if (options.json) {
    writeFileSync(options.json, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`\nwrote ${options.json}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
