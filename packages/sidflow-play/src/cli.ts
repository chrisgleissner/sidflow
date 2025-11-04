#!/usr/bin/env bun

import process from "node:process";
import { resolve } from "node:path";
import { loadConfig, type SIDFlowConfig } from "@sidflow/common";
import {
  createPlaylistBuilder,
  createPlaybackController,
  createSessionManager,
  exportPlaylist,
  parseFilters,
  ExportFormat,
  type PlaylistConfig,
  type PlaybackEvent,
  PlaybackState
} from "./index.js";

interface CliOptions {
  configPath?: string;
  mood?: string;
  filters?: string;
  export?: string;
  exportFormat?: string;
  limit?: number;
  explorationFactor?: number;
  diversityThreshold?: number;
  sidplayPath?: string;
  playOnly?: boolean;
  exportOnly?: boolean;
  minDuration?: number;
}

interface ParseResult {
  options: CliOptions;
  errors: string[];
  helpRequested: boolean;
}

function printHelp(): void {
  const lines = [
    "Usage: sidflow play [options]",
    "",
    "Personal radio for SID music with mood-based playlist generation.",
    "",
    "Options:",
    "  --config <path>              Load an alternate .sidflow.json",
    "  --mood <preset>              Mood preset (quiet, ambient, energetic, dark, bright, complex)",
    "  --filters <expr>             Filter expression (e.g., 'e>=4,m>=3,bpm=120-140')",
    "  --limit <n>                  Number of songs in playlist (default: 20)",
    "  --exploration <0-1>          Exploration factor (default: 0.2)",
    "  --diversity <0-1>            Diversity threshold (default: 0.2)",
    "  --min-duration <seconds>     Minimum song duration in seconds (default: 15)",
    "  --sidplay <path>             Override sidplayfp executable",
    "  --export <path>              Export playlist to file",
    "  --export-format <fmt>        Export format: json, m3u, m3u8 (default: json)",
    "  --export-only                Export playlist without playing",
    "  --play-only                  Play without interactive controls",
    "  --help                       Show this message and exit",
    "",
    "Filter Syntax:",
    "  e>=4                         Energy >= 4",
    "  m<=2                         Mood <= 2",
    "  c=5                          Complexity = 5",
    "  bpm=120-140                  BPM between 120 and 140",
    "  e>=4,m>=3,c<=2               Multiple filters (comma-separated)",
    "",
    "Mood Presets:",
    "  quiet      - Low energy, calm mood, simple complexity",
    "  ambient    - Moderate energy, neutral mood",
    "  energetic  - High energy, upbeat mood",
    "  dark       - Moderate energy, somber mood",
    "  bright     - High energy, upbeat mood",
    "  complex    - High complexity focus",
    "",
    "Examples:",
    "  sidflow play --mood energetic --limit 30",
    "  sidflow play --filters 'e>=4,m>=4' --export playlist.json",
    "  sidflow play --mood dark --export-format m3u --export playlist.m3u",
    "  sidflow play --mood quiet --min-duration 30",
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function parsePlayArgs(argv: string[]): ParseResult {
  const options: CliOptions = {};
  const errors: string[] = [];
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--help":
        helpRequested = true;
        break;
      case "--config": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--config requires a value");
        } else {
          options.configPath = next;
          index += 1;
        }
        break;
      }
      case "--mood": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--mood requires a value");
        } else {
          options.mood = next;
          index += 1;
        }
        break;
      }
      case "--filters": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--filters requires a value");
        } else {
          options.filters = next;
          index += 1;
        }
        break;
      }
      case "--limit": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--limit requires a value");
        } else {
          const num = Number(next);
          if (Number.isNaN(num) || num <= 0) {
            errors.push("--limit must be a positive number");
          } else {
            options.limit = num;
            index += 1;
          }
        }
        break;
      }
      case "--exploration": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--exploration requires a value");
        } else {
          const num = Number(next);
          if (Number.isNaN(num) || num < 0 || num > 1) {
            errors.push("--exploration must be between 0 and 1");
          } else {
            options.explorationFactor = num;
            index += 1;
          }
        }
        break;
      }
      case "--diversity": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--diversity requires a value");
        } else {
          const num = Number(next);
          if (Number.isNaN(num) || num < 0 || num > 1) {
            errors.push("--diversity must be between 0 and 1");
          } else {
            options.diversityThreshold = num;
            index += 1;
          }
        }
        break;
      }
      case "--sidplay": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--sidplay requires a value");
        } else {
          options.sidplayPath = next;
          index += 1;
        }
        break;
      }
      case "--min-duration": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--min-duration requires a value");
        } else {
          const num = Number(next);
          if (Number.isNaN(num) || num < 0) {
            errors.push("--min-duration must be a non-negative number");
          } else {
            options.minDuration = num;
            index += 1;
          }
        }
        break;
      }
      case "--export": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--export requires a value");
        } else {
          options.export = next;
          index += 1;
        }
        break;
      }
      case "--export-format": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--export-format requires a value");
        } else {
          if (!["json", "m3u", "m3u8"].includes(next)) {
            errors.push("--export-format must be json, m3u, or m3u8");
          } else {
            options.exportFormat = next;
            index += 1;
          }
        }
        break;
      }
      case "--export-only":
        options.exportOnly = true;
        break;
      case "--play-only":
        options.playOnly = true;
        break;
      default:
        if (token.startsWith("--")) {
          errors.push(`Unknown option: ${token}`);
        } else {
          errors.push(`Unexpected argument: ${token}`);
        }
    }

    if (helpRequested) {
      break;
    }
  }

  return { options, errors, helpRequested };
}

async function main(): Promise<void> {
  const { options, errors, helpRequested } = parsePlayArgs(process.argv.slice(2));

  if (helpRequested) {
    printHelp();
    process.exit(0);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`Error: ${error}\n`);
    }
    process.exit(1);
  }

  // Load configuration
  const config = await loadConfig(options.configPath);

  // Validate database exists
  const dbPath = resolve(process.cwd(), "data/sidflow.lance");
  
  try {
    // Check if database directory exists
    const { stat } = await import("node:fs/promises");
    await stat(dbPath);
  } catch {
    process.stderr.write("Error: LanceDB database not found. Run 'bun run build:db' first.\n");
    process.exit(1);
  }

  // Build playlist configuration
  const playlistConfig: PlaylistConfig = {
    seed: options.mood || "ambient",
    limit: options.limit,
    explorationFactor: options.explorationFactor,
    diversityThreshold: options.diversityThreshold
  };

  // Parse filters if provided
  if (options.filters) {
    try {
      playlistConfig.filters = parseFilters(options.filters);
    } catch (error) {
      process.stderr.write(`Error: ${(error as Error).message}\n`);
      process.exit(1);
    }
  }

  // Create playlist builder
  const builder = createPlaylistBuilder({ dbPath });
  
  try {
    await builder.connect();
    
    // Generate playlist
    process.stdout.write("Generating playlist...\n");
    const playlist = await builder.build(playlistConfig);
    
    process.stdout.write(`Generated playlist with ${playlist.songs.length} songs\n\n`);

    // Export if requested
    if (options.export) {
      const format = (options.exportFormat || "json") as ExportFormat;
      await exportPlaylist(playlist, {
        outputPath: options.export,
        format,
        rootPath: config.hvscPath
      });
      process.stdout.write(`Playlist exported to ${options.export}\n`);
    }

    // Exit if export-only
    if (options.exportOnly) {
      await builder.disconnect();
      process.exit(0);
    }

    // Start playback
    const sessionManager = createSessionManager("data/sessions");
    await sessionManager.startSession(playlistConfig.seed);

    const controller = createPlaybackController({
      rootPath: config.hvscPath,
      sidplayPath: options.sidplayPath || config.sidplayPath,
      minDuration: options.minDuration,
      onEvent: (event: PlaybackEvent) => {
        sessionManager.recordEvent(event);
        
        switch (event.type) {
          case "started":
            process.stdout.write(`▶️  Playing: ${event.song?.sid_path}\n`);
            break;
          case "finished":
            process.stdout.write(`✅ Finished: ${event.song?.sid_path}\n`);
            break;
          case "skipped":
            process.stdout.write(`⏭️  Skipped: ${event.song?.sid_path}\n`);
            break;
          case "error":
            process.stderr.write(`❌ Error: ${event.error?.message}\n`);
            break;
        }
      }
    });

    controller.loadQueue(playlist.songs);

    // Setup graceful shutdown
    const shutdown = async () => {
      process.stdout.write("\n\nStopping playback...\n");
      await controller.stop();
      await sessionManager.endSession();
      await builder.disconnect();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start playback
    process.stdout.write("\nStarting playback... (Press Ctrl+C to stop)\n\n");
    await controller.play();

    // Wait for playback to finish
    while (controller.getState() !== PlaybackState.IDLE) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await sessionManager.endSession();
    await builder.disconnect();
    
  } catch (error) {
    process.stderr.write(`Error: ${(error as Error).message}\n`);
    await builder.disconnect();
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch(error => {
    process.stderr.write(`Fatal error: ${error.message}\n`);
    process.exit(1);
  });
}
