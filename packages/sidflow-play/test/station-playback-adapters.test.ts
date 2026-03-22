/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";

import { buildSidplayArgs, createPlaybackAdapter } from "../src/station/playback-adapters.js";
import type { StationTrackDetails, StationCliOptions } from "../src/station/types.js";
import type { SidflowConfig } from "@sidflow/common";

function makeTrack(overrides: Partial<StationTrackDetails> = {}): StationTrackDetails {
  return {
    track_id: "track-1",
    sid_path: "Rob_Hubbard/Delta.sid",
    song_index: 1,
    absolutePath: "/hvsc/Rob_Hubbard/Delta.sid",
    title: "Delta",
    author: "Rob Hubbard",
    released: "1987",
    e: 3,
    m: 3,
    c: 3,
    p: null,
    likes: 0,
    dislikes: 0,
    skips: 0,
    plays: 0,
    last_played: null,
    durationMs: 180_000,
    ...overrides,
  };
}

describe("buildSidplayArgs", () => {
  it("builds correct args for a standard track", () => {
    const track = makeTrack({ durationMs: 180_000, song_index: 1, absolutePath: "/hvsc/Delta.sid" });
    const args = buildSidplayArgs(track);
    expect(args).toEqual(["-q", "-os", "-o1", "-t180", "/hvsc/Delta.sid"]);
  });

  it("rounds up fractional seconds", () => {
    const track = makeTrack({ durationMs: 90_500, song_index: 2, absolutePath: "/path/song.sid" });
    const args = buildSidplayArgs(track);
    // Math.ceil(90500/1000) = 91
    expect(args).toContain("-t91");
  });

  it("uses at least 1 second even for very short tracks", () => {
    const track = makeTrack({ durationMs: 10, song_index: 1, absolutePath: "/path/short.sid" });
    const args = buildSidplayArgs(track);
    // Math.max(1, Math.ceil(10/1000)) = Math.max(1, 1) = 1
    expect(args).toContain("-t1");
  });

  it("uses 1 second when durationMs is undefined", () => {
    const track = makeTrack({ durationMs: undefined, absolutePath: "/path/song.sid" });
    const args = buildSidplayArgs(track);
    // Undefined duration should resolve to fallback (≥1 second)
    expect(Number(args.find((a) => a.startsWith("-t"))?.slice(2))).toBeGreaterThanOrEqual(1);
  });

  it("uses the correct song_index", () => {
    const track = makeTrack({ song_index: 5, absolutePath: "/path/song.sid" });
    const args = buildSidplayArgs(track);
    expect(args).toContain("-o5");
  });

  it("always includes quiet and stereo flags", () => {
    const args = buildSidplayArgs(makeTrack());
    expect(args).toContain("-q");
    expect(args).toContain("-os");
  });
});

describe("createPlaybackAdapter", () => {
  const baseConfig: SidflowConfig = {
    sidPath: "/hvsc",
    audioCachePath: "/cache",
    tagsPath: "/tags",
    threads: 1,
    classificationDepth: 1,
  } as SidflowConfig;

  const baseOptions: StationCliOptions = {};

  it("returns a noop adapter for mode=none", async () => {
    const adapter = await createPlaybackAdapter("none", baseConfig, baseOptions);
    // Noop adapter should silently accept any calls
    const track = makeTrack();
    await expect(adapter.start(track)).resolves.toBeUndefined();
    await expect(adapter.stop()).resolves.toBeUndefined();
    await expect(adapter.pause()).resolves.toBeUndefined();
    await expect(adapter.resume()).resolves.toBeUndefined();
  });

  it("throws when mode=local and no sidplayPath configured", async () => {
    await expect(
      createPlaybackAdapter("local", baseConfig, baseOptions),
    ).rejects.toThrow("Local playback requires sidplayPath");
  });

  it("returns local adapter when sidplayPath is in options", async () => {
    const adapter = await createPlaybackAdapter("local", baseConfig, {
      sidplayPath: "/usr/local/bin/sidplayfp",
    });
    // We can't easily test start() without a real sidplayfp binary, but at
    // least the adapter is returned without error.
    expect(adapter).toBeDefined();
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.stop).toBe("function");
  });

  it("returns local adapter when sidplayPath is in config", async () => {
    const config: SidflowConfig = {
      ...baseConfig,
      sidplayPath: "/usr/local/bin/sidplayfp",
    };
    const adapter = await createPlaybackAdapter("local", config, {});
    expect(adapter).toBeDefined();
  });

  it("throws when mode=c64u and no host configured", async () => {
    await expect(
      createPlaybackAdapter("c64u", baseConfig, baseOptions),
    ).rejects.toThrow("C64U playback requires");
  });

  it("returns c64u adapter when host is in options", async () => {
    const adapter = await createPlaybackAdapter("c64u", baseConfig, {
      c64uHost: "192.168.1.100",
    });
    expect(adapter).toBeDefined();
    expect(typeof adapter.start).toBe("function");
  });

  it("returns c64u adapter when host is in config", async () => {
    const config: SidflowConfig = {
      ...baseConfig,
      render: {
        ultimate64: { host: "192.168.1.200" },
      } as SidflowConfig["render"],
    };
    const adapter = await createPlaybackAdapter("c64u", config, {});
    expect(adapter).toBeDefined();
  });
});
