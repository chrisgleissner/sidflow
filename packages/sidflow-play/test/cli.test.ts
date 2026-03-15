/// <reference types="bun-types" />

import { describe, expect, test, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Writable } from "node:stream";
import type { Stats } from "node:fs";

import { parsePlayArgs, runPlayCli } from "../src/cli.js";
import { parseStationDemoArgs, runStationDemoCli } from "../src/station-demo-cli.js";
import { PlaybackState, type PlaybackEvent } from "../src/index.js";
import type { Recommendation } from "@sidflow/common";
import type { Playlist, PlaylistConfig } from "../src/playlist.js";
import type { PlaybackOptions } from "../src/playback.js";

async function createStationDemoFixture(): Promise<{ dbPath: string; workspace: string }> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "sidflow-station-demo-"));
  const dbPath = path.join(workspace, "sidcorr.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tracks (
      track_id TEXT PRIMARY KEY,
      sid_path TEXT NOT NULL,
      song_index INTEGER NOT NULL,
      vector_json TEXT,
      e INTEGER NOT NULL,
      m INTEGER NOT NULL,
      c INTEGER NOT NULL,
      p INTEGER,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      skips INTEGER NOT NULL DEFAULT 0,
      plays INTEGER NOT NULL DEFAULT 0,
      last_played TEXT
    );
  `);
  const insert = db.query(`
    INSERT INTO tracks (track_id, sid_path, song_index, vector_json, e, m, c, p, likes, dislikes, skips, plays, last_played)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run("A/song1.sid#1", "A/song1.sid", 1, JSON.stringify([1, 0, 0]), 5, 4, 2, 4, 2, 0, 0, 5, null);
  insert.run("A/song2.sid#1", "A/song2.sid", 1, JSON.stringify([0.9, 0.1, 0]), 4, 5, 2, 5, 1, 0, 0, 3, null);
  insert.run("B/song3.sid#1", "B/song3.sid", 1, JSON.stringify([0, 1, 0]), 2, 2, 4, 2, 0, 0, 0, 1, null);
  insert.run("C/song4.sid#1", "C/song4.sid", 1, JSON.stringify([0.95, 0.05, 0]), 5, 5, 3, 5, 3, 0, 0, 8, null);
  insert.run("D/song5.sid#1", "D/song5.sid", 1, JSON.stringify([0.85, 0.15, 0]), 4, 4, 3, 4, 2, 0, 0, 4, null);
  db.close();
  return { dbPath, workspace };
}

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
    expect(result.options.exploration).toBe(0.5);
    expect(result.errors).toHaveLength(0);
  });

  test("parses diversity option", () => {
    const result = parsePlayArgs(["--diversity", "0.3"]);
    expect(result.options.diversity).toBe(0.3);
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
    expect(result.errors[0]).toContain("must be at least 1");
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
    expect(result.options.exploration).toBe(0.4);
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
    expect(result.errors[0]).toContain("must be an integer");
  });

  test("returns error for invalid exploration", () => {
    const result = parsePlayArgs(["--exploration", "2.0"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be at most 1");
  });

  // Note: export-format validation is now done at runtime, not in parseArgs
  test("accepts export format during parsing", () => {
    const result = parsePlayArgs(["--export-format", "invalid"]);
    // The parser accepts it; validation happens later in runPlayCli
    expect(result.options.exportFormat).toBe("invalid");
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

describe("station demo CLI argument parsing", () => {
  test("parses station demo defaults", () => {
    const result = parseStationDemoArgs([]);
    expect(result.options.playback).toBeUndefined();
    expect(result.options.adventure).toBe(3);
    expect(result.options.sampleSize).toBe(10);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects invalid adventure during parsing", () => {
    const result = parseStationDemoArgs(["--adventure", "9"]);
    expect(result.errors[0]).toContain("must be at most 5");
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
      audioCachePath: "/wav",
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
        audioCachePath: "/wav",
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
        audioCachePath: "/wav",
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
        audioCachePath: "/wav",
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
        audioCachePath: "/wav",
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
    expect(captured.join("")).toContain("Usage: sidflow-play");
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

  it("reports invalid export format at runtime", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--export-format", "invalid"], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        audioCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      })
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("must be json, m3u, or m3u8");
  });

  it("runs the station demo against the exported sqlite without playback", async () => {
    const fixture = await createStationDemoFixture();
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

    const answers = ["5", "4", "n", "q"];
    const exitCode = await runStationDemoCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "2",
        "--station-size", "2",
        "--adventure", "2",
      ],
      {
        stdout,
        stderr,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 123_000,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    const output = stdoutChunks.join("");
    expect(output).toContain("Recommendations come from the SQLite export");
    expect(output).toContain("Station ready with 2 tracks from the standalone SQLite export");
    expect(output).toContain("Previous:");
    expect(output).toContain("Current:");
  });

  it("infers c64u playback when a c64u host is supplied", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationDemoCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--c64u-host", "192.168.1.13",
        "--sample-size", "1",
        "--station-size", "1",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
        random: () => 0,
        createPlaybackAdapter: async (mode) => {
          expect(mode).toBe("c64u");
          return {
            start: async () => undefined,
            stop: async () => undefined,
          };
        },
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 30_000,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdoutChunks.join("")).toContain("Playback mode: c64u");
  });
});
