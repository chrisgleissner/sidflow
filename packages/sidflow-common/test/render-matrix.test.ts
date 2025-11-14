import { describe, expect, test } from "bun:test";
import {
  validateRenderMode,
  getSupportedRenderModes,
  getRenderModesByLocation,
  getRenderModesByTechnology,
  isTechnologyAvailable,
  type RenderMode,
} from "../src/render-matrix";

describe("Render Matrix", () => {
  test("validates supported server prepared sidplayfp-cli render", () => {
    const mode: RenderMode = {
      location: "server",
      time: "prepared",
      technology: "sidplayfp-cli",
      target: "wav-m4a-flac",
    };

    const result = validateRenderMode(mode);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("validates supported client realtime wasm playback", () => {
    const mode: RenderMode = {
      location: "client",
      time: "realtime",
      technology: "wasm",
      target: "playback-only",
    };

    const result = validateRenderMode(mode);
    expect(result.valid).toBe(true);
  });

  test("validates supported server ultimate64 prepared render", () => {
    const mode: RenderMode = {
      location: "server",
      time: "prepared",
      technology: "ultimate64",
      target: "wav-m4a-flac",
    };

    const result = validateRenderMode(mode);
    expect(result.valid).toBe(true);
  });

  test("rejects invalid render mode combination", () => {
    const mode: RenderMode = {
      location: "client",
      time: "prepared",
      technology: "wasm",
      target: "wav-m4a-flac",
    };

    const result = validateRenderMode(mode);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.suggestedAlternatives).toBeDefined();
  });

  test("rejects future render mode", () => {
    const mode: RenderMode = {
      location: "server",
      time: "prepared",
      technology: "wasm",
      target: "wav-m4a-flac",
    };

    const result = validateRenderMode(mode);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not yet implemented");
  });

  test("returns all supported render modes", () => {
    const modes = getSupportedRenderModes();
    expect(modes.length).toBeGreaterThan(0);

    // Should include the MVP modes
    expect(
      modes.some(
        (m) =>
          m.location === "server" &&
          m.time === "prepared" &&
          m.technology === "sidplayfp-cli"
      )
    ).toBe(true);

    expect(
      modes.some(
        (m) =>
          m.location === "client" &&
          m.time === "realtime" &&
          m.technology === "wasm"
      )
    ).toBe(true);
  });

  test("filters render modes by location", () => {
    const serverModes = getRenderModesByLocation("server");
    expect(serverModes.length).toBeGreaterThan(0);
    expect(serverModes.every((m) => m.location === "server")).toBe(true);

    const clientModes = getRenderModesByLocation("client");
    expect(clientModes.length).toBeGreaterThan(0);
    expect(clientModes.every((m) => m.location === "client")).toBe(true);
  });

  test("filters render modes by technology", () => {
    const wasmModes = getRenderModesByTechnology("wasm");
    expect(wasmModes.length).toBeGreaterThan(0);
    expect(wasmModes.every((m) => m.technology === "wasm")).toBe(true);

    const cliModes = getRenderModesByTechnology("sidplayfp-cli");
    expect(cliModes.length).toBeGreaterThan(0);
    expect(cliModes.every((m) => m.technology === "sidplayfp-cli")).toBe(true);
  });

  test("checks technology availability correctly", () => {
    // WASM is available for client realtime
    expect(isTechnologyAvailable("wasm", "client", "realtime")).toBe(true);

    // sidplayfp-cli is available for server prepared
    expect(isTechnologyAvailable("sidplayfp-cli", "server", "prepared")).toBe(
      true
    );

    // Ultimate 64 is available for server prepared
    expect(isTechnologyAvailable("ultimate64", "server", "prepared")).toBe(
      true
    );

    // WASM is NOT available for server prepared (status: future)
    expect(isTechnologyAvailable("wasm", "server", "prepared")).toBe(false);

    // sidplayfp-cli is NOT available for client realtime (status: future)
    expect(isTechnologyAvailable("sidplayfp-cli", "client", "realtime")).toBe(
      false
    );
  });

  test("provides suggested alternatives for invalid modes", () => {
    const mode: RenderMode = {
      location: "server",
      time: "prepared",
      technology: "wasm",
      target: "wav-m4a-flac",
    };

    const result = validateRenderMode(mode);
    expect(result.valid).toBe(false);
    expect(result.suggestedAlternatives).toBeDefined();
    expect(result.suggestedAlternatives!.length).toBeGreaterThan(0);

    // Should suggest server prepared alternatives
    const serverPrepared = result.suggestedAlternatives!.some(
      (alt) => alt.location === "server" && alt.time === "prepared"
    );
    expect(serverPrepared).toBe(true);
  });
});
