import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runSimilarityExportCli } from "../src/similarity-export-cli.js";

describe("similarity-export-cli", () => {
  const configPath = path.resolve(process.cwd(), ".sidflow.test.json");

  test("rejects --source-sqlite for tiny exports", async () => {
    const exitCode = await runSimilarityExportCli([
      "--config", configPath,
      "--format", "tiny",
      "--source-lite", "data/exports/example.sidcorr",
      "--source-sqlite", "data/exports/example.sqlite",
    ]);

    expect(exitCode).toBe(1);
  });

  test("rejects --neighbor-source-sqlite outside tiny exports", async () => {
    const exitCode = await runSimilarityExportCli([
      "--config", configPath,
      "--format", "lite",
      "--source-sqlite", "data/exports/example.sqlite",
      "--neighbor-source-sqlite", "data/exports/hint.sqlite",
    ]);

    expect(exitCode).toBe(1);
  });
});
