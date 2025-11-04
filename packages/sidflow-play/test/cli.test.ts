/**
 * Tests for CLI argument parsing.
 */

import { describe, expect, test } from "bun:test";
import { parsePlayArgs } from "../src/cli.js";

describe("CLI argument parsing", () => {
  test("parses help flag", () => {
    const result = parsePlayArgs(["--help"]);
    expect(result.helpRequested).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("parses mood option", () => {
    const result = parsePlayArgs(["--mood", "energetic"]);
    expect(result.options.mood).toBe("energetic");
    expect(result.errors).toHaveLength(0);
  });

  test("parses filters option", () => {
    const result = parsePlayArgs(["--filters", "e>=4,m>=3"]);
    expect(result.options.filters).toBe("e>=4,m>=3");
    expect(result.errors).toHaveLength(0);
  });

  test("parses limit option", () => {
    const result = parsePlayArgs(["--limit", "30"]);
    expect(result.options.limit).toBe(30);
    expect(result.errors).toHaveLength(0);
  });

  test("parses exploration option", () => {
    const result = parsePlayArgs(["--exploration", "0.5"]);
    expect(result.options.explorationFactor).toBe(0.5);
    expect(result.errors).toHaveLength(0);
  });

  test("parses diversity option", () => {
    const result = parsePlayArgs(["--diversity", "0.3"]);
    expect(result.options.diversityThreshold).toBe(0.3);
    expect(result.errors).toHaveLength(0);
  });

  test("parses export options", () => {
    const result = parsePlayArgs([
      "--export", "playlist.json",
      "--export-format", "json"
    ]);
    expect(result.options.export).toBe("playlist.json");
    expect(result.options.exportFormat).toBe("json");
    expect(result.errors).toHaveLength(0);
  });

  test("parses sidplay option", () => {
    const result = parsePlayArgs(["--sidplay", "/usr/bin/sidplayfp"]);
    expect(result.options.sidplayPath).toBe("/usr/bin/sidplayfp");
    expect(result.errors).toHaveLength(0);
  });

  test("parses min-duration option", () => {
    const result = parsePlayArgs(["--min-duration", "30"]);
    expect(result.options.minDuration).toBe(30);
    expect(result.errors).toHaveLength(0);
  });

  test("returns error for invalid min-duration", () => {
    const result = parsePlayArgs(["--min-duration", "invalid"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be a non-negative number");
  });

  test("parses export-only flag", () => {
    const result = parsePlayArgs(["--export-only"]);
    expect(result.options.exportOnly).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("parses play-only flag", () => {
    const result = parsePlayArgs(["--play-only"]);
    expect(result.options.playOnly).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("parses multiple options", () => {
    const result = parsePlayArgs([
      "--mood", "energetic",
      "--limit", "50",
      "--exploration", "0.4",
      "--export", "out.json"
    ]);
    expect(result.options.mood).toBe("energetic");
    expect(result.options.limit).toBe(50);
    expect(result.options.explorationFactor).toBe(0.4);
    expect(result.options.export).toBe("out.json");
    expect(result.errors).toHaveLength(0);
  });

  test("returns error for missing option value", () => {
    const result = parsePlayArgs(["--mood"]);
    expect(result.errors).toContain("--mood requires a value");
  });

  test("returns error for invalid limit", () => {
    const result = parsePlayArgs(["--limit", "invalid"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be a positive number");
  });

  test("returns error for invalid exploration", () => {
    const result = parsePlayArgs(["--exploration", "2.0"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be between 0 and 1");
  });

  test("returns error for invalid export format", () => {
    const result = parsePlayArgs(["--export-format", "invalid"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be json, m3u, or m3u8");
  });

  test("returns error for unknown option", () => {
    const result = parsePlayArgs(["--unknown"]);
    expect(result.errors).toContain("Unknown option: --unknown");
  });

  test("returns error for unexpected argument", () => {
    const result = parsePlayArgs(["unexpected"]);
    expect(result.errors).toContain("Unexpected argument: unexpected");
  });
});
