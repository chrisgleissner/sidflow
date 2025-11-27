/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { RenderOrchestrator } from "../src/render/render-orchestrator.js";

const TEST_SID_PATH = path.join(
  process.cwd(),
  "test-data/C64Music/MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid"
);

describe("RenderOrchestrator (sidplayfp-cli time limits)", () => {
  let tempDir: string;
  let argsFile: string;
  let mockCliPath: string;
  let orchestrator: RenderOrchestrator;
  let renderCount = 0;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-render-cli-limit-"));
    argsFile = path.join(tempDir, "args.txt");
    mockCliPath = path.join(tempDir, "sidplayfp-mock.sh");
    renderCount = 0;

    const script = `#!/usr/bin/env bash
set -euo pipefail
args_file=${JSON.stringify(argsFile)}
wav_path=""
for arg in "$@"; do
  case "$arg" in
    -w*) wav_path="\${arg#-w}";;
  esac
done
if [ -n "$wav_path" ]; then
  echo "dummy" > "$wav_path"
fi
printf "%s\n" "$@" > "$args_file"
`;
    await writeFile(mockCliPath, script, { mode: 0o755 });
    orchestrator = new RenderOrchestrator({ sidplayfpCliPath: mockCliPath });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function renderAndReadArgs(options: {
    targetDurationMs?: number;
    maxRenderSeconds?: number;
  }): Promise<string[]> {
    const outputDir = path.join(tempDir, `out-${renderCount++}`);

    await orchestrator.render({
      sidPath: TEST_SID_PATH,
      outputDir,
      engine: "sidplayfp-cli",
      formats: ["wav"],
      songIndex: 1,
      targetDurationMs: options.targetDurationMs,
      maxRenderSeconds: options.maxRenderSeconds,
    });

    const raw = await readFile(argsFile, "utf8");
    return raw.trim().split(/\s+/);
  }

  it("passes a Songlengths-based time limit to sidplayfp-cli", async () => {
    const args = await renderAndReadArgs({ targetDurationMs: 18_193 });
    const timeArg = args.find((arg) => arg.startsWith("-t"));
    expect(timeArg).toBe("-t21");
  });

  it("applies a fallback render cap when no songlength is provided", async () => {
    const args = await renderAndReadArgs({});
    const timeArg = args.find((arg) => arg.startsWith("-t"));
    expect(timeArg).toBe("-t600");
  });
});
