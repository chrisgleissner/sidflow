#!/usr/bin/env bun

import process from "node:process";
import path from "node:path";
import { SidPlaybackHarness } from "@sidflow/common";

import {
  DEFAULT_RATINGS,
  createTagFilePath,
  findUntaggedSids,
  interpretKey,
  planTagSession,
  shuffleInPlace,
  writeManualTag,
  type KeyState,
  type TagCliOptions,
  type TagRatings
} from "./index.js";

interface CliOptions extends TagCliOptions { }

interface ParseResult {
  options: CliOptions;
  errors: string[];
  helpRequested: boolean;
}

function printHelp(): void {
  const lines = [
    "Usage: sidflow rate [options]",
    "",
    "Interactively rate SID tunes with energy, mood, complexity, and preference ratings.",
    "Playback uses the shared WASM harness; ensure ffplay or aplay is available for audio output.",
    "",
    "Options:",
    "  --config <path>   Load an alternate .sidflow.json",
    "  --random          Shuffle the unrated queue",
    "  --help            Show this message and exit"
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function parseTagArgs(argv: string[]): ParseResult {
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
      case "--random":
        options.random = true;
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

function printInstructions(): void {
  const lines = [
    "Controls:",
    "  e1-5: set energy",
    "  m1-5: set mood",
    "  c1-5: set complexity",
    "  p1-5: set preference",
    "  Enter: save and advance",
    "  Q: quit",
    "",
    "Default rating level is 3."
  ];
  process.stdout.write(`${lines.join("\n")}\n\n`);
}

function formatRatings(ratings: TagRatings): string {
  const parts = [`e=${ratings.e}`, `m=${ratings.m}`, `c=${ratings.c}`];
  if (ratings.p !== undefined) {
    parts.push(`p=${ratings.p}`);
  }
  return parts.join(" ");
}

export async function runTagCli(argv: string[]): Promise<number> {
  const { options, errors, helpRequested } = parseTagArgs(argv);

  if (helpRequested) {
    printHelp();
    return errors.length > 0 ? 1 : 0;
  }

  if (errors.length > 0) {
    errors.forEach((message) => {
      process.stderr.write(`${message}\n`);
    });
    process.stderr.write("Use --help to list supported options.\n");
    return 1;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Interactive tagging requires a TTY.\n");
    return 1;
  }

  const session = await planTagSession({ configPath: options.configPath, random: options.random });
  const playbackHarness = new SidPlaybackHarness();
  const queue = await findUntaggedSids(session.hvscPath, session.tagsPath);

  if (queue.length === 0) {
    process.stdout.write("All SIDs are already tagged.\n");
    return 0;
  }

  if (session.random) {
    shuffleInPlace(queue);
  }

  printInstructions();

  const formatRelativeSid = (sidFile: string): string => {
    const relative = path.relative(session.hvscPath, sidFile);
    if (!relative || relative.startsWith("..")) {
      return sidFile;
    }
    return relative;
  };

  return await new Promise<number>((resolve) => {
    let resolved = false;
    let currentIndex = 0;
    let state: KeyState = { ratings: { ...DEFAULT_RATINGS } };
    let isSaving = false;
    let handleData: ((chunk: string) => void) | null = null;
    let handleSigint: (() => void) | null = null;

    const stopPlayback = async (): Promise<void> => {
      try {
        await playbackHarness.stop();
      } catch {
        // ignore cleanup errors during shutdown
      }
    };

    const startPlayback = async (sidFile: string): Promise<void> => {
      try {
        await playbackHarness.start({ sidPath: sidFile });
      } catch (error) {
        process.stderr.write(
          `Failed to start playback for ${formatRelativeSid(sidFile)}: ${(error as Error).message}\n`
        );
      }
    };

    const printTrackBanner = (sidFile: string): void => {
      process.stdout.write(`\n▶ ${formatRelativeSid(sidFile)}\n`);
      process.stdout.write(`${formatRatings(state.ratings)}\n`);
    };

    const advance = async (): Promise<void> => {
      if (isSaving || resolved) {
        return;
      }
      isSaving = true;
      try {
        const sidFile = queue[currentIndex];
        const tagPath = createTagFilePath(session.hvscPath, session.tagsPath, sidFile);
        await writeManualTag(tagPath, state.ratings, new Date());
        process.stdout.write(`Saved tags to ${tagPath}\n`);
        currentIndex += 1;

        if (currentIndex >= queue.length) {
          finalize(0, "\nAll done – enjoy the playlists!");
          return;
        }

        state = { ratings: { ...DEFAULT_RATINGS } };
        const nextFile = queue[currentIndex];
        await startPlayback(nextFile);
        printTrackBanner(nextFile);
      } finally {
        isSaving = false;
      }
    };

    const quit = (): void => {
      finalize(0, "\nSession ended without saving.");
    };

    const handleHarnessFinished = (): void => {
      if (resolved) {
        return;
      }
      const sidFile = queue[currentIndex];
      if (!sidFile) {
        return;
      }
      process.stdout.write(
        `\n⏹ Playback reached the end of ${formatRelativeSid(sidFile)} – restarting for review.\n`
      );
      void startPlayback(sidFile);
    };

    const handleHarnessError = (error: Error): void => {
      if (resolved) {
        return;
      }
      process.stderr.write(`Playback error: ${error.message}\n`);
    };

    const finalize = (code: number, message?: string): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      playbackHarness.off("finished", handleHarnessFinished);
      playbackHarness.off("error", handleHarnessError);
      if (handleData) {
        process.stdin.off("data", handleData);
      }
      if (handleSigint) {
        process.off("SIGINT", handleSigint);
      }
      void stopPlayback();
      if (message) {
        process.stdout.write(`${message}\n`);
      }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      resolve(code);
    };

    playbackHarness.on("finished", handleHarnessFinished);
    playbackHarness.on("error", handleHarnessError);

    const firstFile = queue[currentIndex];
    void startPlayback(firstFile);
    printTrackBanner(firstFile);

    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    handleData = (chunk: string): void => {
      for (const char of chunk) {
        const previous = state;
        const result = interpretKey(char, state);
        state = result.state;

        if (previous.ratings !== state.ratings) {
          process.stdout.write(`${formatRatings(state.ratings)}\n`);
        }

        if (result.action === "save") {
          void advance();
        }

        if (result.action === "quit") {
          quit();
          return;
        }
      }
    };

    handleSigint = (): void => {
      quit();
    };

    process.stdin.on("data", handleData);
    process.on("SIGINT", handleSigint);
  });
}

if (import.meta.main) {
  runTagCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
