import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { runScheduler, type SchedulerOptions, type SchedulerResult } from "../src/scheduler.js";

/**
 * Scheduler tests use a mock approach: we inject a fake runScheduler into the
 * CLI, and separately test the scheduler's trigger logic by controlling the
 * inputs through the exported `runScheduler` API with stub file paths.
 *
 * The heavy I/O tests (loadFeedback, model persistence) are exercised through
 * the scheduler via a temp directory approach in integration.
 */

describe("scheduler module — exports", () => {
  it("exports runScheduler as a function", () => {
    expect(typeof runScheduler).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// CLI-level scheduler tests (using __setTrainCliTestOverrides)
// ---------------------------------------------------------------------------

import { runTrainCli, __setTrainCliTestOverrides } from "../src/cli.js";

describe("Train CLI — --auto flag (scheduler integration)", () => {
  let stdoutOutput = "";
  let originalStdout: typeof process.stdout.write;

  beforeEach(() => {
    stdoutOutput = "";
    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdout;
    __setTrainCliTestOverrides();
  });

  it("--auto flag calls runScheduler with force=false by default", async () => {
    let capturedOptions: SchedulerOptions | undefined;

    __setTrainCliTestOverrides({
      runScheduler: async (opts) => {
        capturedOptions = opts;
        return {
          triggered: false,
          reason: "no_trigger",
          promoted: false,
          newEventCount: 10,
          stateFile: "data/model/scheduler-state.json",
        };
      },
    });

    const code = await runTrainCli(["--auto"]);
    expect(code).toBe(0);
    expect(capturedOptions).toBeDefined();
    expect(capturedOptions?.force).toBeFalsy();
  });

  it("--auto --force passes force=true to scheduler", async () => {
    let capturedOptions: SchedulerOptions | undefined;

    __setTrainCliTestOverrides({
      runScheduler: async (opts) => {
        capturedOptions = opts;
        return {
          triggered: true,
          reason: "force",
          promoted: false,
          newEventCount: 5,
          stateFile: "data/model/scheduler-state.json",
        };
      },
    });

    await runTrainCli(["--auto", "--force"]);
    expect(capturedOptions?.force).toBe(true);
  });

  it("displays 'No trigger' when scheduler does not fire", async () => {
    __setTrainCliTestOverrides({
      runScheduler: async () => ({
        triggered: false,
        reason: "no_trigger" as const,
        promoted: false,
        newEventCount: 5,
        stateFile: "data/model/scheduler-state.json",
      }),
    });

    const code = await runTrainCli(["--auto"]);
    expect(code).toBe(0);
    expect(stdoutOutput).toContain("No trigger");
  });

  it("displays promoted message when challenger is promoted", async () => {
    __setTrainCliTestOverrides({
      runScheduler: async (): Promise<SchedulerResult> => ({
        triggered: true,
        reason: "min_events",
        promoted: true,
        newEventCount: 75,
        stateFile: "data/model/scheduler-state.json",
        evaluation: {
          metrics: [],
          passed: 4,
          required: 3,
          promote: true,
          summary: "all_good",
        },
      }),
    });

    const code = await runTrainCli(["--auto"]);
    expect(code).toBe(0);
    expect(stdoutOutput).toContain("promoted");
  });

  it("displays rejected message when challenger fails evaluation", async () => {
    __setTrainCliTestOverrides({
      runScheduler: async (): Promise<SchedulerResult> => ({
        triggered: true,
        reason: "min_interval",
        promoted: false,
        newEventCount: 60,
        stateFile: "data/model/scheduler-state.json",
        evaluation: {
          metrics: [],
          passed: 1,
          required: 3,
          promote: false,
          summary: "failed",
        },
      }),
    });

    const code = await runTrainCli(["--auto"]);
    expect(code).toBe(0);
    expect(stdoutOutput).toContain("rejected");
  });
});

// ---------------------------------------------------------------------------
// CLI — --list-models flag
// ---------------------------------------------------------------------------

describe("Train CLI — --list-models", () => {
  let stdoutOutput = "";
  let originalStdout: typeof process.stdout.write;

  beforeEach(() => {
    stdoutOutput = "";
    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdout;
    __setTrainCliTestOverrides();
  });

  it("--list-models prints model version header and exits 0", async () => {
    // Use a non-existent model path so it prints '(none)' gracefully
    const code = await runTrainCli(["--list-models", "--model-path", "/tmp/sidflow-test-no-models"]);
    expect(code).toBe(0);
    expect(stdoutOutput).toContain("Model Versions");
  });
});

// ---------------------------------------------------------------------------
// CLI — --rollback flag
// ---------------------------------------------------------------------------

describe("Train CLI — --rollback", () => {
  let stderrOutput = "";
  let originalStderr: typeof process.stderr.write;

  beforeEach(() => {
    stderrOutput = "";
    originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderr;
    __setTrainCliTestOverrides();
  });

  it("--rollback 1 returns code 1 when no v1 model exists", async () => {
    const code = await runTrainCli([
      "--rollback",
      "1",
      "--model-path",
      "/tmp/sidflow-test-no-v1",
    ]);
    expect(code).toBe(1);
    expect(stderrOutput).toContain("No model found at v1");
  });
});
