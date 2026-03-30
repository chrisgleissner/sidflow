#!/usr/bin/env bun

import process from "node:process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadConfig,
  MOOD_PRESETS,
  createPlaybackLock,
  parseArgs,
  formatHelp,
  handleParseResult,
  PERSONAS,
  PERSONA_LIST,
  parsePersonaId,
  scoreTrackForPersona,
  scoreWithFallback,
  applyRecencyPenalty,
  type MoodPresetName,
  type SidflowConfig,
  type ArgDef,
  type PersonaId,
  type PersonaMetrics,
  type PersonaProfile,
  type Recommendation,
} from "@sidflow/common";
import type { Stats } from "node:fs";
import {
  runC64ULedCli,
  createPlaylistBuilder,
  createPlaybackController,
  createSessionManager,
  exportPlaylist,
  runSimilarityExportCli,
  runStationDemoCli,
  parseFilters,
  ExportFormat,
  type Playlist,
  type PlaylistConfig,
  type PlaybackEvent,
  PlaybackState
} from "./index.js";

interface CliOptions {
  config?: string;
  mood?: string;
  persona?: string;
  filters?: string;
  export?: string;
  exportFormat?: string;
  limit?: number;
  exploration?: number;
  diversity?: number;
  playOnly?: boolean;
  exportOnly?: boolean;
  minDuration?: number;
}

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json"
  },
  {
    name: "--mood",
    type: "string",
    description: "Mood preset (quiet, ambient, energetic, dark, bright, complex)"
  },
  {
    name: "--persona",
    type: "string",
    description: "Listening persona (fast-paced, slow-ambient, melodic, experimental, nostalgic, composer-focus, era-explorer, deep-discovery, theme-hunter)"
  },
  {
    name: "--filters",
    type: "string",
    description: "Filter expression (e.g., 'e>=4,m>=3,bpm=120-140')"
  },
  {
    name: "--limit",
    type: "integer",
    description: "Number of songs in playlist",
    defaultValue: 20,
    constraints: { positive: true }
  },
  {
    name: "--exploration",
    type: "float",
    description: "Exploration factor",
    defaultValue: 0.2,
    constraints: { min: 0, max: 1 }
  },
  {
    name: "--diversity",
    type: "float",
    description: "Diversity threshold",
    defaultValue: 0.2,
    constraints: { min: 0, max: 1 }
  },
  {
    name: "--min-duration",
    type: "integer",
    description: "Minimum song duration in seconds",
    defaultValue: 15,
    constraints: { min: 1 }
  },
  {
    name: "--export",
    type: "string",
    description: "Export playlist to file"
  },
  {
    name: "--export-format",
    type: "string",
    description: "Export format: json, m3u, m3u8",
    defaultValue: "json"
  },
  {
    name: "--export-only",
    type: "boolean",
    description: "Export playlist without playing"
  },
  {
    name: "--play-only",
    type: "boolean",
    description: "Play without interactive controls"
  }
];

const HELP_TEXT = formatHelp(
  "sidflow-play [options]",
  `Personal radio for SID music with mood-based playlist generation.
Playback uses the WASM SidPlaybackHarness; ensure either ffplay or aplay is available locally.

Filter Syntax:
  e>=4                         Energy >= 4
  m<=2                         Mood <= 2
  c=5                          Complexity = 5
  bpm=120-140                  BPM between 120 and 140
  e>=4,m>=3,c<=2               Multiple filters (comma-separated)

Mood Presets:
  quiet      - Low energy, calm mood, simple complexity
  ambient    - Moderate energy, neutral mood
  energetic  - High energy, upbeat mood
  dark       - Moderate energy, somber mood
  bright     - High energy, upbeat mood
  complex    - High complexity focus

Listening Personas:
  fast-paced       - High energy, rhythmic drive
  slow-ambient     - Calm, low tempo
  melodic          - Rich melodies, harmonic depth
  experimental     - Unusual timbres, sonic exploration
  nostalgic        - Classic SID, warm familiarity
  composer-focus   - One composer, without manual browsing
  era-explorer     - Historically coherent era journeys
  deep-discovery   - Obscure deep cuts near your taste
  theme-hunter     - Theme-led stations from track titles`,
  ARG_DEFS,
  [
    "sidflow-play --mood energetic --limit 30",
    "sidflow-play --persona melodic --limit 30",
    "sidflow-play --filters 'e>=4,m>=4' --export playlist.json",
    "sidflow-play --mood dark --export-format m3u --export playlist.m3u",
    "sidflow-play --persona fast-paced --min-duration 30"
  ]
);

function isMoodPreset(value: string): value is MoodPresetName {
  return Object.hasOwn(MOOD_PRESETS, value);
}

export function parsePlayArgs(argv: string[]) {
  return parseArgs<CliOptions>(argv, ARG_DEFS);
}

interface PlaylistBuilderLike {
  connect(): Promise<void>;
  build(config: PlaylistConfig): Promise<Playlist>;
  disconnect(): Promise<void>;
}

interface SessionManagerLike {
  startSession(seed?: PlaylistConfig["seed"]): Promise<void>;
  recordEvent(event: PlaybackEvent): void;
  endSession(): Promise<void>;
}

interface PlaybackControllerLike {
  loadQueue(songs: Playlist["songs"]): void;
  play(): Promise<void>;
  stop(): Promise<void>;
  getState(): PlaybackState;
}

interface PlayCliRuntime {
  loadConfig: (configPath?: string) => Promise<SidflowConfig>;
  createPlaylistBuilder: (options: Parameters<typeof createPlaylistBuilder>[0]) => PlaylistBuilderLike;
  createPlaybackController: (options: Parameters<typeof createPlaybackController>[0]) => PlaybackControllerLike;
  createSessionManager: (sessionPath: Parameters<typeof createSessionManager>[0]) => SessionManagerLike;
  exportPlaylist: typeof exportPlaylist;
  parseFilters: typeof parseFilters;
  stat: (path: string) => Promise<Stats>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  cwd: () => string;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  offSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  sleep: (ms: number) => Promise<void>;
}

const defaultRuntime: PlayCliRuntime = {
  loadConfig,
  createPlaylistBuilder: (options) => createPlaylistBuilder(options),
  createPlaybackController: (options) => createPlaybackController(options),
  createSessionManager: (sessionPath) => createSessionManager(sessionPath),
  exportPlaylist,
  parseFilters,
  stat,
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: () => process.cwd(),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  offSignal: (signal, handler) => {
    process.off(signal, handler);
  },
  sleep: async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
};

function mergeRuntime(overrides?: Partial<PlayCliRuntime>): PlayCliRuntime {
  if (!overrides) {
    return defaultRuntime;
  }
  return {
    ...defaultRuntime,
    ...overrides,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr
  };
}

/**
 * Derive approximate PersonaMetrics from a Recommendation's ratings.
 * This is a lightweight approximation used when the full 24D vector is unavailable.
 * The real metrics are better computed from the full vector (as persona-station.ts does).
 */
function deriveMetricsFromRatings(ratings: { e?: number; m?: number; c?: number }): PersonaMetrics {
  const e = typeof ratings.e === "number" ? (ratings.e - 1) / 4 : 0.5;
  const m = typeof ratings.m === "number" ? (ratings.m - 1) / 4 : 0.5;
  const c = typeof ratings.c === "number" ? (ratings.c - 1) / 4 : 0.5;
  return {
    rhythmicDensity: Math.max(0, Math.min(1, e)),
    melodicComplexity: Math.max(0, Math.min(1, (m + c) / 2)),
    timbralRichness: Math.max(0, Math.min(1, c * 0.7 + e * 0.3)),
    nostalgiaBias: Math.max(0, Math.min(1, m * 0.6 + (1 - e) * 0.4)),
    experimentalTolerance: Math.max(0, Math.min(1, c * 0.6 + (1 - m) * 0.4)),
  };
}

/**
 * Re-rank a playlist's songs using persona scoring with optional profile and recency.
 */
function rerankForPersona(
  songs: Recommendation[],
  personaId: PersonaId,
  limit: number,
  profile?: PersonaProfile | null,
  sessionHistory?: string[],
): Recommendation[] {
  const scored = songs.map((song) => {
    const metrics = deriveMetricsFromRatings(song.ratings);
    const context = { metrics, ratings: song.ratings };
    let score = profile
      ? scoreWithFallback(context, personaId, profile)
      : scoreTrackForPersona(context, personaId).score;
    if (sessionHistory && sessionHistory.length > 0) {
      score = applyRecencyPenalty(score, song.sid_path, sessionHistory);
    }
    return { song, personaScore: score };
  });
  scored.sort((a, b) => b.personaScore - a.personaScore);
  return scored.slice(0, limit).map((entry) => entry.song);
}

export async function runPlayCli(argv: string[], overrides?: Partial<PlayCliRuntime>): Promise<number> {
  if (argv[0] === "c64u-led") {
    return runC64ULedCli(argv.slice(1));
  }

  if (argv[0] === "export-similarity") {
    return runSimilarityExportCli(argv.slice(1));
  }

  if (argv[0] === "station" || argv[0] === "station-demo") {
    return runStationDemoCli(argv.slice(1));
  }

  if (argv[0] === "persona-station") {
    const { runPersonaStationCli } = await import("./persona-station.js");
    return runPersonaStationCli(argv.slice(1));
  }

  const result = parsePlayArgs(argv);
  const runtime = mergeRuntime(overrides);

  const exitCode = handleParseResult(result, HELP_TEXT, runtime.stdout, runtime.stderr);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;

  // Additional validation for export-format
  if (options.exportFormat && !["json", "m3u", "m3u8"].includes(options.exportFormat)) {
    runtime.stderr.write(`Error: --export-format must be json, m3u, or m3u8\n`);
    return 1;
  }

  // Validate --persona
  let activePersonaId: PersonaId | null = null;
  if (options.persona) {
    const parsed = parsePersonaId(options.persona);
    if (!parsed) {
      runtime.stderr.write(`Error: Unknown persona: ${options.persona}\nValid personas: ${PERSONA_LIST.map((p) => p.id.replace(/_/g, "-")).join(", ")}\n`);
      return 1;
    }
    activePersonaId = parsed;
  }

  // --mood and --persona are mutually exclusive
  if (options.mood && activePersonaId) {
    runtime.stderr.write("Error: --mood and --persona cannot be used together\n");
    return 1;
  }

  let config: SidflowConfig;
  try {
    config = await runtime.loadConfig(options.config);
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  }

  const dbPath = resolve(runtime.cwd(), "data/sidflow.lance");

  try {
    await runtime.stat(dbPath);
  } catch {
    runtime.stderr.write("Error: LanceDB database not found. Run 'bun run build:db' first.\n");
    return 1;
  }

  const mood = options.mood;

  let seed: PlaylistConfig["seed"] = "ambient";
  if (activePersonaId) {
    // Use persona's rating targets as the seed for the recommendation engine
    const persona = PERSONAS[activePersonaId];
    seed = { e: persona.ratingTargets.e, m: persona.ratingTargets.m, c: persona.ratingTargets.c };
  } else if (mood) {
    if (isMoodPreset(mood)) {
      seed = mood;
    } else {
      runtime.stderr.write(`Error: Unknown mood preset: ${mood}\n`);
      return 1;
    }
  }

  // When using persona, request a larger pool for re-ranking
  const requestLimit = activePersonaId
    ? Math.min((options.limit ?? 20) * 3, 200)
    : options.limit;

  const playlistConfig: PlaylistConfig = {
    seed,
    limit: requestLimit,
    explorationFactor: options.exploration,
    diversityThreshold: options.diversity
  };

  if (options.filters) {
    try {
      playlistConfig.filters = runtime.parseFilters(options.filters);
    } catch (error) {
      runtime.stderr.write(`Error: ${(error as Error).message}\n`);
      return 1;
    }
  }

  const builder = runtime.createPlaylistBuilder({ dbPath });
  let connected = false;
  let signalHandler: (() => void) | null = null;
  const playbackLock = await createPlaybackLock(config);

  try {
    await builder.connect();
    connected = true;

    runtime.stdout.write("Generating playlist...\n");
    const playlist = await builder.build(playlistConfig);

    // Re-rank for persona if active
    if (activePersonaId) {
      const targetLimit = options.limit ?? 20;
      const reranked = rerankForPersona(playlist.songs, activePersonaId, targetLimit);
      playlist.songs = reranked;
      playlist.metadata.count = reranked.length;
      const personaLabel = PERSONAS[activePersonaId].label;
      runtime.stdout.write(`Persona: ${personaLabel} — re-ranked ${playlist.songs.length} tracks\n\n`);
    } else {
      runtime.stdout.write(`Generated playlist with ${playlist.songs.length} songs\n\n`);
    }

    if (options.export) {
      const format = (options.exportFormat || "json") as ExportFormat;
      await runtime.exportPlaylist(playlist, {
        outputPath: options.export,
        format,
        rootPath: config.sidPath
      });
      runtime.stdout.write(`Playlist exported to ${options.export}\n`);
    }

    if (options.exportOnly) {
      return 0;
    }

    const sessionManager = runtime.createSessionManager("data/sessions");
    await sessionManager.startSession(playlistConfig.seed);

    await playbackLock.stopExistingPlayback("sidflow-play");

    const controller = runtime.createPlaybackController({
      rootPath: config.sidPath,
      minDuration: options.minDuration,
      playbackLock,
      playbackSource: "sidflow-play",
      onEvent: (event: PlaybackEvent) => {
        sessionManager.recordEvent(event);

        switch (event.type) {
          case "started":
            runtime.stdout.write(`▶️  Playing: ${event.song?.sid_path}\n`);
            break;
          case "finished":
            runtime.stdout.write(`✅ Finished: ${event.song?.sid_path}\n`);
            break;
          case "skipped":
            runtime.stdout.write(`⏭️  Skipped: ${event.song?.sid_path}\n`);
            break;
          case "error":
            runtime.stderr.write(`❌ Error: ${event.error?.message}\n`);
            break;
        }
      }
    });

    controller.loadQueue(playlist.songs);

    const shutdown = async () => {
      runtime.stdout.write("\n\nStopping playback...\n");
      await controller.stop();
      await playbackLock.forceRelease();
      await sessionManager.endSession();
    };

    const handleSignal = () => {
      void shutdown();
    };

    signalHandler = handleSignal;
    runtime.onSignal("SIGINT", handleSignal);
    runtime.onSignal("SIGTERM", handleSignal);

    if (activePersonaId) {
      const personaLabel = PERSONAS[activePersonaId].label;
      runtime.stdout.write(`\nStarting playback [${personaLabel}]... (Press Ctrl+C to stop)\n\n`);
    } else {
      runtime.stdout.write("\nStarting playback... (Press Ctrl+C to stop)\n\n");
    }
    await controller.play();

    while (controller.getState() !== PlaybackState.IDLE) {
      await runtime.sleep(1000);
    }

    await sessionManager.endSession();
    return 0;
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  } finally {
    if (signalHandler) {
      runtime.offSignal("SIGINT", signalHandler);
      runtime.offSignal("SIGTERM", signalHandler);
    }
    if (connected) {
      await builder.disconnect();
    }
  }
}

if (import.meta.main) {
  runPlayCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`Fatal error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
