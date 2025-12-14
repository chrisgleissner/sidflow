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
  type MoodPresetName,
  type SidflowConfig,
  type ArgDef
} from "@sidflow/common";
import type { Stats } from "node:fs";
import {
  createPlaylistBuilder,
  createPlaybackController,
  createSessionManager,
  exportPlaylist,
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
  complex    - High complexity focus`,
  ARG_DEFS,
  [
    "sidflow-play --mood energetic --limit 30",
    "sidflow-play --filters 'e>=4,m>=4' --export playlist.json",
    "sidflow-play --mood dark --export-format m3u --export playlist.m3u",
    "sidflow-play --mood quiet --min-duration 30"
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

export async function runPlayCli(argv: string[], overrides?: Partial<PlayCliRuntime>): Promise<number> {
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
  if (mood) {
    if (isMoodPreset(mood)) {
      seed = mood;
    } else {
      runtime.stderr.write(`Error: Unknown mood preset: ${mood}\n`);
      return 1;
    }
  }

  const playlistConfig: PlaylistConfig = {
    seed,
    limit: options.limit,
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
    runtime.stdout.write(`Generated playlist with ${playlist.songs.length} songs\n\n`);

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

    runtime.stdout.write("\nStarting playback... (Press Ctrl+C to stop)\n\n");
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
