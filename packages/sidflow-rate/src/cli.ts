#!/usr/bin/env bun

import process from "node:process";
import path from "node:path";
import {
  SidPlaybackHarness,
  parseArgs,
  formatHelp,
  handleParseResult,
  type ArgDef
} from "@sidflow/common";

import {
  DEFAULT_RATINGS,
  createTagFilePath,
  findUntaggedSids,
  interpretKey,
  planTagSession,
  shuffleInPlace,
  writeManualTag,
  type KeyState,
  type TagRatings
} from "./index.js";

interface CliOptions {
  config?: string;
  random?: boolean;
}

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json"
  },
  {
    name: "--random",
    type: "boolean",
    description: "Shuffle the unrated queue"
  }
];

const HELP_TEXT = formatHelp(
  "sidflow rate [options]",
  "Interactively rate SID tunes with energy, mood, complexity, and preference ratings.\nPlayback uses the shared WASM harness; ensure ffplay or aplay is available for audio output.",
  ARG_DEFS
);

export function parseTagArgs(argv: string[]) {
  return parseArgs<CliOptions>(argv, ARG_DEFS);
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
  const result = parseTagArgs(argv);

  const exitCode = handleParseResult(result, HELP_TEXT);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Interactive tagging requires a TTY.\n");
    return 1;
  }

  const session = await planTagSession({ configPath: options.config, random: options.random });
  const playbackHarness = new SidPlaybackHarness();
  const queue = await findUntaggedSids(session.sidPath, session.tagsPath);

  if (queue.length === 0) {
    process.stdout.write("All SIDs are already tagged.\n");
    return 0;
  }

  if (session.random) {
    shuffleInPlace(queue);
  }

  printInstructions();

  const formatRelativeSid = (sidFile: string): string => {
    const relative = path.relative(session.sidPath, sidFile);
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
        const tagPath = createTagFilePath(session.sidPath, session.tagsPath, sidFile);
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
        const resultState = interpretKey(char, state);
        state = resultState.state;

        if (previous.ratings !== state.ratings) {
          process.stdout.write(`${formatRatings(state.ratings)}\n`);
        }

        if (resultState.action === "save") {
          void advance();
        }

        if (resultState.action === "quit") {
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
