import { readFile } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import {
  Ultimate64Client,
  type SidflowConfig,
} from "@sidflow/common";
import type { StationTrackDetails, PlaybackAdapter, StationCliOptions, PlaybackMode } from "./types.js";
import { resolveTrackDurationMs } from "./formatting.js";
import { U64_SID_VOLUME_REGISTERS } from "./constants.js";

export function buildSidplayArgs(track: StationTrackDetails): string[] {
  const durationMs = resolveTrackDurationMs(track);
  const wholeSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  return ["-q", "-os", `-o${track.song_index}`, `-t${wholeSeconds}`, track.absolutePath];
}

class NoopPlaybackAdapter implements PlaybackAdapter {
  async start(_track: StationTrackDetails): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    return;
  }

  async pause(): Promise<void> {
    return;
  }

  async resume(): Promise<void> {
    return;
  }
}

class LocalSidplayPlaybackAdapter implements PlaybackAdapter {
  private current: ChildProcess | null = null;
  private paused = false;

  constructor(private readonly sidplayPath: string) {}

  async start(track: StationTrackDetails): Promise<void> {
    await this.stop();
    const { spawn } = await import("node:child_process");

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let stderr = "";
      const proc = spawn(this.sidplayPath, buildSidplayArgs(track), {
        stdio: ["ignore", "ignore", "pipe"],
      });

      this.current = proc;
      this.paused = false;

      const startupTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 300);

      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.once("error", (error) => {
        this.current = null;
        clearTimeout(startupTimer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      proc.once("exit", (code) => {
        if (this.current === proc) {
          this.current = null;
        }

        clearTimeout(startupTimer);
        if (!settled) {
          settled = true;
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`sidplayfp exited with code ${code}: ${stderr.trim()}`));
          }
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.current) {
      this.paused = false;
      return;
    }

    const proc = this.current;
    this.current = null;
    this.paused = false;
    if (proc.exitCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(forceResolveTimer);
        proc.off("close", finish);
        proc.off("exit", finish);
        resolve();
      };

      const killTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill("SIGKILL");
        }
      }, 500);
      const forceResolveTimer = setTimeout(finish, 1_000);

      proc.once("close", finish);
      proc.once("exit", finish);
      proc.kill("SIGTERM");
    });
  }

  async pause(): Promise<void> {
    if (!this.current || this.paused || this.current.exitCode !== null) {
      return;
    }
    this.current.kill("SIGSTOP");
    this.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.current || !this.paused || this.current.exitCode !== null) {
      return;
    }
    this.current.kill("SIGCONT");
    this.paused = false;
  }
}

class Ultimate64PlaybackAdapter implements PlaybackAdapter {
  private sidVolumes: Uint8Array = Uint8Array.from([0x0f, 0x0f, 0x0f]);
  private paused = false;

  constructor(private readonly client: Ultimate64Client) {}

  async start(track: StationTrackDetails): Promise<void> {
    const buffer = await readFile(track.absolutePath);
    this.paused = false;
    await this.client.sidplay({ sidBuffer: buffer, songNumber: track.song_index });
  }

  async stop(): Promise<void> {
    this.paused = false;
    await this.client.reset();
  }

  async pause(): Promise<void> {
    if (this.paused) {
      return;
    }

    try {
      this.sidVolumes = await this.captureSidVolumes();
    } catch {
      // Keep the most recent known values if the machine cannot serve memory reads.
    }

    await Promise.all(
      U64_SID_VOLUME_REGISTERS.map(async (address, index) => {
        await this.client.writeMemory({ address, data: new Uint8Array([this.sidVolumes[index]! & 0xf0]) });
      }),
    );
    await this.client.pause();
    this.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.paused) {
      return;
    }
    await Promise.all(
      U64_SID_VOLUME_REGISTERS.map(async (address, index) => {
        await this.client.writeMemory({ address, data: new Uint8Array([this.sidVolumes[index]]) });
      }),
    );
    await this.client.resume();
    this.paused = false;
  }

  private async captureSidVolumes(): Promise<Uint8Array> {
    const values = await Promise.all(
      U64_SID_VOLUME_REGISTERS.map(async (address, index) => {
        try {
          const data = await this.client.readMemory({ address, length: 1 });
          return data[0] ?? this.sidVolumes[index] ?? 0x0f;
        } catch {
          return this.sidVolumes[index] ?? 0x0f;
        }
      }),
    );
    return Uint8Array.from(values);
  }
}

export async function createPlaybackAdapter(
  mode: PlaybackMode,
  config: SidflowConfig,
  options: StationCliOptions,
): Promise<PlaybackAdapter> {
  if (mode === "none") {
    return new NoopPlaybackAdapter();
  }

  if (mode === "local") {
    const sidplayPath = options.sidplayPath ?? config.sidplayPath;
    if (!sidplayPath) {
      throw new Error("Local playback requires sidplayPath in config or --sidplay-path");
    }
    return new LocalSidplayPlaybackAdapter(sidplayPath);
  }

  const ultimate64 = config.render?.ultimate64;
  const host = options.c64uHost ?? ultimate64?.host;
  const https = options.c64uHttps ?? ultimate64?.https;
  const password = options.c64uPassword ?? ultimate64?.password;

  if (!host) {
    throw new Error("C64U playback requires render.ultimate64.host in config or --c64u-host");
  }

  return new Ultimate64PlaybackAdapter(
    new Ultimate64Client({
      host,
      https,
      password,
    }),
  );
}
