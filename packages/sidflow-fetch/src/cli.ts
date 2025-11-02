#!/usr/bin/env bun

import process from "node:process";

import { syncHvsc } from "./sync.js";

interface FetchCliOptions {
  configPath?: string;
  remoteBaseUrl?: string;
  hvscVersionPath?: string;
}

interface ParseResult {
  options: FetchCliOptions;
  errors: string[];
  helpRequested: boolean;
}

function printHelp(): void {
  const lines = [
    "Usage: sidflow fetch [options]",
    "",
    "Synchronise the High Voltage SID Collection with the latest base archive",
    "and any newer delta archives.",
    "",
    "Options:",
    "  --config <path>        Load an alternate .sidflow.json file",
    "  --remote <url>         Override the HVSC mirror base URL",
    "  --version-file <path>  Custom location for hvsc-version.json",
    "  --help                 Show this message and exit"
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function parseFetchArgs(argv: string[]): ParseResult {
  const options: FetchCliOptions = {};
  const errors: string[] = [];
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--help": {
        helpRequested = true;
        break;
      }
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
      case "--remote": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--remote requires a value");
        } else {
          options.remoteBaseUrl = next;
          index += 1;
        }
        break;
      }
      case "--version-file": {
        const next = argv[index + 1];
        if (!next) {
          errors.push("--version-file requires a value");
        } else {
          options.hvscVersionPath = next;
          index += 1;
        }
        break;
      }
      default: {
        if (token.startsWith("--")) {
          errors.push(`Unknown option: ${token}`);
        } else {
          errors.push(`Unexpected argument: ${token}`);
        }
        break;
      }
    }

    if (helpRequested) {
      break;
    }
  }

  return { options, errors, helpRequested };
}

export async function runFetchCli(argv: string[], runner: typeof syncHvsc = syncHvsc): Promise<number> {
  const { options, errors, helpRequested } = parseFetchArgs(argv);

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

  try {
    const result = await runner({
      configPath: options.configPath,
      remoteBaseUrl: options.remoteBaseUrl,
      hvscVersionPath: options.hvscVersionPath
    });

    const summaryLines = [
      "HVSC sync completed.",
      `Base archive updated: ${result.baseUpdated ? "yes" : "no"}`,
      `Applied deltas: ${result.appliedDeltas.length > 0 ? result.appliedDeltas.join(", ") : "none"}`,
      `Base version: ${result.baseVersion} (last synced ${result.baseSyncedAt})`
    ];
    process.stdout.write(`${summaryLines.join("\n")}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Sync failed: ${(error as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  runFetchCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
