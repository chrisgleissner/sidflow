/// <reference types="bun-types" />

import { describe, expect, test, it } from "bun:test";
import { Writable } from "node:stream";
import type { Stats } from "node:fs";

import { parsePlayArgs, runPlayCli } from "../src/cli.js";
import { PlaybackState, type PlaybackEvent } from "../src/index.js";
import type { Recommendation } from "@sidflow/common";
import type { Playlist, PlaylistConfig } from "../src/playlist.js";
import type { PlaybackOptions } from "../src/playback.js";

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

  test("parses min-duration option", () => {
    const result = parsePlayArgs(["--min-duration", "30"]);
    expect(result.options.minDuration).toBe(30);
    expect(result.errors).toHaveLength(0);
  });

  test("returns error for invalid min-duration", () => {
    const result = parsePlayArgs(["--min-duration", "0"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be at least 1 second");
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

describe("runPlayCli", () => {
  it("runs full playback flow with overrides", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrChunks.push(chunk.toString());
        callback();
      }
    });

    let builderConnected = false;
    let builderDisconnected = false;
    let exportInvocation: { format: string; path: string } | null = null;
    const registeredHandlers: Array<() => void> = [];
    const sleepCalls: number[] = [];
    const recordedEvents: PlaybackEvent[] = [];
    let sessionStarts = 0;
    let sessionEnds = 0;

    const config = {
      sidPath: "/music",
      wavCachePath: "/wav",
      tagsPath: "/tags",
      threads: 4,
      classificationDepth: 2
    };

    const song: Recommendation = {
      sid_path: "relative/song.sid",
      score: 0.9,
      similarity: 0.85,
      songFeedback: 0.2,
      userAffinity: 0.3,
      ratings: { e: 3, m: 3, c: 3 },
      feedback: { likes: 1, dislikes: 0, skips: 0, plays: 1 }
    };

    const playlist: Playlist = {
      metadata: {
        createdAt: new Date().toISOString(),
        seed: "quiet",
        count: 1,
        filters: { energyRange: [4, 5] }
      },
      songs: [song]
    };

    const exitCode = await runPlayCli(
      [
        "--mood",
        "quiet",
        "--limit",
        "10",
        "--filters",
        "e>=4",
        "--export",
        "/tmp/list.json",
        "--export-format",
        "json"
      ],
      {
        stdout,
        stderr,
        loadConfig: async () => config,
        cwd: () => "/workspace",
        stat: async (_path: string) => ({}) as Stats,
        parseFilters: (expression: string) => {
          expect(expression).toBe("e>=4");
          return { energyRange: [4, 5] };
        },
        createPlaylistBuilder: () => ({
          connect: async () => {
            builderConnected = true;
          },
          build: async (buildConfig: PlaylistConfig) => {
            expect(buildConfig.seed).toBe("quiet");
            expect(buildConfig.limit).toBe(10);
            expect(buildConfig.filters?.energyRange).toEqual([4, 5]);
            return playlist;
          },
          disconnect: async () => {
            builderDisconnected = true;
          }
        }),
        createSessionManager: () => ({
          startSession: async () => {
            sessionStarts += 1;
          },
          recordEvent: (event: PlaybackEvent) => {
            recordedEvents.push(event);
          },
          endSession: async () => {
            sessionEnds += 1;
          }
        }),
        createPlaybackController: (options: PlaybackOptions) => {
          let state: PlaybackState = PlaybackState.IDLE;
          let queue: Recommendation[] = [];

          return {
            loadQueue: (songs: Recommendation[]) => {
              queue = songs;
            },
            play: async () => {
              state = PlaybackState.PLAYING;
              const current = queue[0];
              options.onEvent?.({ type: "started", song: current } as PlaybackEvent);
              options.onEvent?.({ type: "finished", song: current } as PlaybackEvent);
              state = PlaybackState.IDLE;
              for (const handler of registeredHandlers) {
                handler();
              }
            },
            stop: async () => {
              state = PlaybackState.IDLE;
            },
            getState: () => state
          };
        },
        exportPlaylist: async (value, descriptor) => {
          expect(value.songs).toHaveLength(1);
          exportInvocation = { format: descriptor.format, path: descriptor.outputPath };
        },
        onSignal: (_signal, handler) => {
          registeredHandlers.push(handler);
        },
        offSignal: (_signal, handler) => {
          const index = registeredHandlers.indexOf(handler);
          if (index >= 0) {
            registeredHandlers.splice(index, 1);
          }
        },
        sleep: async (ms: number) => {
          sleepCalls.push(ms);
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(builderConnected).toBe(true);
    expect(builderDisconnected).toBe(true);
    expect(exportInvocation).not.toBeNull();
    const invocation = exportInvocation!;
    expect(invocation).toEqual({ format: "json", path: "/tmp/list.json" });
    expect(sessionStarts).toBe(1);
    expect(sessionEnds).toBeGreaterThanOrEqual(1);
    expect(recordedEvents.some((event) => event.type === "started")).toBe(true);
    expect(stdoutChunks.join("\n")).toContain("Generating playlist");
    expect(stdoutChunks.join("\n")).toContain("Starting playback");
    expect(stdoutChunks.join("\n")).toContain("Stopping playback");
    expect(sleepCalls).toHaveLength(0);
  });

  it("handles export-only mode without playback", async () => {
    let playInvoked = false;

    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });

    const exitCode = await runPlayCli([
      "--export",
      "/tmp/list.json",
      "--export-only"
    ], {
      stdout,
      loadConfig: async () => ({
        sidPath: "/music",
        wavCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => ({}) as Stats,
      parseFilters: () => ({}),
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async (_config: PlaylistConfig) => ({
          metadata: {
            createdAt: new Date().toISOString(),
            seed: "ambient",
            count: 0
          },
          songs: []
        } satisfies Playlist),
        disconnect: async () => undefined
      }),
      exportPlaylist: async () => undefined,
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => {
          playInvoked = true;
        },
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(0);
    expect(playInvoked).toBe(false);
  });

  it("reports unknown mood presets", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--mood", "unknown"], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        wavCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => ({}) as Stats,
      parseFilters: () => ({}),
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async () => {
          throw new Error("should not build");
        },
        disconnect: async () => undefined
      }),
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => undefined,
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Unknown mood preset");
  });

  it("reports database missing errors", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli([], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        wavCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => {
        throw new Error("missing");
      },
      parseFilters: () => ({}),
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async (_config: PlaylistConfig) => ({
          metadata: {
            createdAt: new Date().toISOString(),
            seed: "ambient",
            count: 0
          },
          songs: []
        } satisfies Playlist),
        disconnect: async () => undefined
      }),
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => undefined,
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("LanceDB database not found");
  });

  it("handles filter parsing errors", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--filters", "invalid"], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        wavCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => ({}) as Stats,
      parseFilters: () => {
        throw new Error("bad filters");
      },
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async (_config: PlaylistConfig) => ({
          metadata: {
            createdAt: new Date().toISOString(),
            seed: "ambient",
            count: 0
          },
          songs: []
        } satisfies Playlist),
        disconnect: async () => undefined
      }),
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => undefined,
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("bad filters");
  });

  it("prints help when requested", async () => {
    const captured: string[] = [];
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--help"], { stdout });

    expect(exitCode).toBe(0);
    expect(captured.join("")).toContain("Usage: sidflow play");
  });

  it("reports argument parsing errors", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--limit", "0"], { stderr });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("--limit must be a positive number");
  });
});
