#!/usr/bin/env bun

import process from "node:process";
import { spawn } from "node:child_process";

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

interface CliOptions extends TagCliOptions {
  sidplayPath?: string;
}

interface ParseResult {
  options: CliOptions;
  errors: string[];
  helpRequested: boolean;
}

function printHelp(): void {
  const lines = [
    "Usage: sidflow tag [options]",
    "",
    "Interactively label SID tunes with speed, mood, and complexity sliders.",
    "",
    "Options:",
    "  --config <path>   Load an alternate .sidflow.json",
    "  --sidplay <path>  Override the sidplayfp executable",
    "  --random          Shuffle the untagged queue",
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
    "  s1-5: set speed",
    "  m1-5: set mood",
    "  c1-5: set complexity",
    "  Enter: save and advance",
    "  Q: quit",
    "",
    "Default slider level is 3."
  ];
  process.stdout.write(`${lines.join("\n")}\n\n`);
}

function formatRatings(ratings: TagRatings): string {
  return `s=${ratings.s} m=${ratings.m} c=${ratings.c}`;
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
  const sidplayPath = options.sidplayPath ?? session.sidplayPath;
  const queue = await findUntaggedSids(session.hvscPath, session.tagsPath);

  if (queue.length === 0) {
    process.stdout.write("All SIDs are already tagged.\n");
    return 0;
  }

  if (session.random) {
    shuffleInPlace(queue);
  }

  printInstructions();

  return await new Promise<number>((resolve) => {
    let resolved = false;
    let currentIndex = 0;
    let currentProcess: ReturnType<typeof spawn> | undefined;
    let state: KeyState = { ratings: { ...DEFAULT_RATINGS } };
    let isSaving = false;

    const finalize = (code: number, message?: string): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      stopPlayback();
      if (message) {
        process.stdout.write(`${message}\n`);
      }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      resolve(code);
    };

    const stopPlayback = (): void => {
      if (currentProcess && !currentProcess.killed) {
        currentProcess.kill();
      }
      currentProcess = undefined;
    };

    const startPlayback = (sidFile: string): void => {
      stopPlayback();
      try {
        currentProcess = spawn(sidplayPath, [sidFile], { stdio: "ignore" });
        currentProcess.once("exit", (code) => {
          if (!resolved && code !== 0) {
            process.stderr.write(`sidplayfp exited with code ${code} for ${sidFile}\n`);
          }
        });
        currentProcess.once("error", (error) => {
          process.stderr.write(`Failed to start sidplayfp: ${(error as Error).message}\n`);
        });
      } catch (error) {
        process.stderr.write(`Failed to spawn sidplayfp: ${(error as Error).message}\n`);
      }
    };

    const printTrackBanner = (sidFile: string): void => {
      process.stdout.write(`\n▶ ${sidFile}\n`);
      process.stdout.write(`${formatRatings(state.ratings)}\n`);
    };

    const advance = async (): Promise<void> => {
      if (isSaving || resolved) {
        return;
      }
      isSaving = true;
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
      startPlayback(nextFile);
      printTrackBanner(nextFile);
      isSaving = false;
    };

    const quit = (): void => {
      finalize(0, "\nSession ended without saving.");
    };

    const firstFile = queue[currentIndex];
    startPlayback(firstFile);
    printTrackBanner(firstFile);

    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on("data", (chunk: string) => {
      for (const char of chunk) {
        const previous = state;
        const result = interpretKey(char, state);
        state = result.state;

        if (previous.ratings !== state.ratings) {
          process.stdout.write(`${formatRatings(state.ratings)}\n`);
        }

        if (result.action === "save") {
          void advance().finally(() => {
            isSaving = false;
          });
        }

        if (result.action === "quit") {
          quit();
          return;
        }
      }
    });

    process.on("SIGINT", () => {
      quit();
    });
  });
}

if (import.meta.main) {
  runTagCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
