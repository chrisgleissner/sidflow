import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_PACING_SECONDS } from "../src/constants.js";
import { loadJourneyFile } from "../src/journey-loader.js";
import { generateK6ScriptContent } from "../src/k6-executor.js";
import { generatePlaywrightScriptContent } from "../src/playwright-executor.js";
import { runUnifiedPerformance } from "../src/runner.js";
import { type JourneySpec } from "../src/types.js";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sidflow-perf-"));
}

describe("journey loader", () => {
  it("applies default pacing when missing", async () => {
    const tmp = await createTempDir();
    const journeyPath = path.join(tmp, "journey.json");
    const spec: JourneySpec = {
      id: "sample",
      description: "Test journey",
      steps: [{ action: "navigate", target: "/" }]
    };
    await fs.writeFile(journeyPath, JSON.stringify(spec));

    const loaded = await loadJourneyFile(journeyPath);
    expect(loaded.pacingSeconds).toBe(DEFAULT_PACING_SECONDS);
  });
});

describe("script generation", () => {
  let sample: JourneySpec;

  beforeEach(() => {
    sample = {
      id: "play-start-stream",
      pacingSeconds: 3,
      steps: [
        { action: "navigate", target: "/" },
        { action: "click", selector: "[data-testid='search-input']" },
        { action: "type", selector: "[data-testid='search-input']", value: "ambient" },
        { action: "waitForText", text: "results" },
        { action: "selectTrack", trackRef: "firstResult" },
        { action: "startPlayback", expectStream: true }
      ]
    };
  });

  it("includes pacing waits in Playwright script", () => {
    const content = generatePlaywrightScriptContent(sample, {
      baseUrl: "http://localhost:3000",
      users: 1
    });
    expect(content).toContain("waitForTimeout(pacingMs)");
    expect(content).toContain("chromium.launch");
  });

  it("includes k6 dashboard export env in script metadata", () => {
    const content = generateK6ScriptContent(sample, { baseUrl: "http://localhost:3000", users: 1 });
    expect(content).toContain("k6");
    expect(content).toContain("sleep(3)");
  });
});

describe("runner", () => {
  let tmpJourneys: string;
  let tmpResults: string;
  let tmpScripts: string;

  beforeEach(async () => {
    tmpJourneys = await createTempDir();
    tmpResults = await createTempDir();
    tmpScripts = await createTempDir();
    const spec: JourneySpec = {
      id: "journey-a",
      steps: [
        { action: "navigate", target: "/" },
        { action: "click", selector: "#search" },
        { action: "waitForText", text: "ok" }
      ]
    };
    await fs.writeFile(path.join(tmpJourneys, "journey.json"), JSON.stringify(spec));
  });

  afterEach(async () => {
    await fs.rm(tmpJourneys, { recursive: true, force: true });
    await fs.rm(tmpResults, { recursive: true, force: true });
    await fs.rm(tmpScripts, { recursive: true, force: true });
  });

  it("generates scripts and report with remote guard disabled by default", async () => {
    const result = await runUnifiedPerformance({
      journeyDir: tmpJourneys,
      resultsRoot: tmpResults,
      tmpRoot: tmpScripts,
      environment: { kind: "local", baseUrl: "http://localhost:3000" }
    });

    expect(result.scripts.length).toBeGreaterThan(0);
    const summary = await fs.readFile(result.summaryPath, "utf8");
    expect(summary).toContain("journey-a");
    const report = await fs.readFile(result.reportPath, "utf8");
    expect(report).toContain("journey-a");
  });

  it("refuses remote runs without enableRemote", async () => {
    await expect(
      runUnifiedPerformance({
        journeyDir: tmpJourneys,
        resultsRoot: tmpResults,
        tmpRoot: tmpScripts,
        environment: { kind: "remote", baseUrl: "https://example.com" }
      })
    ).rejects.toThrow("enableRemote");
  });

  it("enforces k6 SLO thresholds when summaries exceed limits", async () => {
    await expect(
      runUnifiedPerformance({
        journeyDir: tmpJourneys,
        resultsRoot: tmpResults,
        tmpRoot: tmpScripts,
        executors: ["k6"],
        execute: true,
        environment: { kind: "local", baseUrl: "http://localhost:3000" },
        commandRunner: async (script) => {
          const summaryPath = path.join(script.resultDir, "summary.json");
          await fs.writeFile(
            summaryPath,
            JSON.stringify({ metrics: { http_req_failed: { rate: 0.2 } } })
          );
        },
        maxErrorRate: 0.1
      })
    ).rejects.toThrow("error rate");
  });

  it("retries playwright executions when configured", async () => {
    let attempts = 0;
    await runUnifiedPerformance({
      journeyDir: tmpJourneys,
      resultsRoot: tmpResults,
      tmpRoot: tmpScripts,
      executors: ["playwright"],
      execute: true,
      playwrightRetries: 1,
      environment: { kind: "local", baseUrl: "http://localhost:3000" },
      commandRunner: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("flaky");
        }
      }
    });
    expect(attempts).toBe(2);
  });
});
