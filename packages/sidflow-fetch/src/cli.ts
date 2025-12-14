#!/usr/bin/env bun

import process from "node:process";
import {
  parseArgs,
  formatHelp,
  handleParseResult,
  type ArgDef
} from "@sidflow/common";

import { syncHvsc } from "./sync.js";

interface FetchCliOptions {
  config?: string;
  remote?: string;
  versionFile?: string;
}

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json file"
  },
  {
    name: "--remote",
    type: "string",
    description: "Override the HVSC mirror base URL"
  },
  {
    name: "--version-file",
    type: "string",
    description: "Custom location for hvsc-version.json"
  }
];

const HELP_TEXT = formatHelp(
  "sidflow-fetch [options]",
  "Synchronise the High Voltage SID Collection with the latest base archive\nand any newer delta archives.",
  ARG_DEFS
);

export function parseFetchArgs(argv: string[]) {
  return parseArgs<FetchCliOptions>(argv, ARG_DEFS);
}

export async function runFetchCli(
  argv: string[],
  runner: typeof syncHvsc = syncHvsc
): Promise<number> {
  const result = parseFetchArgs(argv);

  const exitCode = handleParseResult(result, HELP_TEXT);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;

  try {
    const syncResult = await runner({
      configPath: options.config,
      remoteBaseUrl: options.remote,
      hvscVersionPath: options.versionFile
    });

    const summaryLines = [
      "HVSC sync completed.",
      `Base archive updated: ${syncResult.baseUpdated ? "yes" : "no"}`,
      `Applied deltas: ${syncResult.appliedDeltas.length > 0 ? syncResult.appliedDeltas.join(", ") : "none"}`,
      `Base version: ${syncResult.baseVersion} (last synced ${syncResult.baseSyncedAt})`
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
