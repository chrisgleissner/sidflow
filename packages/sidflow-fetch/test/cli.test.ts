import { afterEach, describe, expect, it } from "bun:test";
import process from "node:process";

import { parseFetchArgs, runFetchCli } from "../src/cli.js";
import type { HvscSyncOptions, HvscSyncResult } from "../src/types.js";

type SyncRunner = (options?: HvscSyncOptions) => Promise<HvscSyncResult>;

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

let capturedStdout = "";
let capturedStderr = "";

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  capturedStdout = "";
  capturedStderr = "";
});

describe("sidflow-fetch CLI", () => {
  it("parses recognised options", () => {
    const result = parseFetchArgs([
      "--config",
      "./config.json",
      "--remote",
      "https://mirror.example/HVSC/",
      "--version-file",
      "./hvsc-version.json"
    ]);

    expect(result.helpRequested).toBeFalse();
    expect(result.errors).toHaveLength(0);
    expect(result.options).toEqual({
      configPath: "./config.json",
      remoteBaseUrl: "https://mirror.example/HVSC/",
      hvscVersionPath: "./hvsc-version.json"
    });
  });

  it("returns help flag without consuming later arguments", () => {
    const result = parseFetchArgs(["--help", "--config", "ignored"]);
    expect(result.helpRequested).toBeTrue();
    expect(result.errors).toHaveLength(0);
  });

  it("runs the sync workflow and reports success", async () => {
    const runner: SyncRunner = async () => ({ baseUpdated: true, appliedDeltas: [83, 84] });

    process.stdout.write = (chunk: string | Uint8Array) => {
      capturedStdout += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    const exitCode = await runFetchCli([
      "--config",
      "./config.json",
      "--remote",
      "https://mirror.example/HVSC/"
    ], runner);

    expect(exitCode).toBe(0);
    expect(capturedStdout).toContain("HVSC sync completed.");
    expect(capturedStdout).toContain("Base archive updated: yes");
    expect(capturedStdout).toContain("Applied deltas: 83, 84");
  });

  it("fails fast on unknown options", async () => {
    process.stderr.write = (chunk: string | Uint8Array) => {
      capturedStderr += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    const exitCode = await runFetchCli(["--unknown"], async () => ({ baseUpdated: false, appliedDeltas: [] }));

    expect(exitCode).toBe(1);
    expect(capturedStderr).toContain("Unknown option: --unknown");
    expect(capturedStderr).toContain("Use --help to list supported options.");
  });

  it("prints help when requested", async () => {
    process.stdout.write = (chunk: string | Uint8Array) => {
      capturedStdout += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    const exitCode = await runFetchCli(["--help"], async () => ({ baseUpdated: false, appliedDeltas: [] }));

    expect(exitCode).toBe(0);
    expect(capturedStdout).toContain("Usage: sidflow fetch");
  });

  it("validates option arity", async () => {
    process.stderr.write = (chunk: string | Uint8Array) => {
      capturedStderr += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    const exitCode = await runFetchCli(["--config"], async () => ({ baseUpdated: false, appliedDeltas: [] }));

    expect(exitCode).toBe(1);
    expect(capturedStderr).toContain("--config requires a value");
  });
});
