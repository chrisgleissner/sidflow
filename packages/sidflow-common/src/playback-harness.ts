import { Buffer } from "node:buffer";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import {
    spawn as defaultSpawn,
    type ChildProcess,
    type SpawnOptionsWithoutStdio
} from "node:child_process";
import loadLibsidplayfp, {
    SidAudioEngine,
    type LibsidplayfpWasmModule
} from "@sidflow/libsidplayfp-wasm";

type SpawnFunction = (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio
) => ChildProcess;

type PlaybackHarnessEvent = "started" | "finished" | "error";

interface EventListenerMap {
    started: Set<(event: PlaybackStartResult) => void>;
    finished: Set<() => void>;
    error: Set<(error: Error) => void>;
}

export interface PlaybackStartOptions {
    sidPath: string;
    songIndex?: number;
    offsetSeconds?: number;
    durationSeconds?: number;
}

export interface PlaybackStartResult {
    pid?: number;
    command: string;
    startedAt: Date;
    offsetSeconds: number;
    durationSeconds?: number;
}

export type PlaybackHarnessState = "idle" | "playing" | "paused";

interface HostAudioFormat {
    sampleRate: number;
    channels: number;
}

interface HostPlayerCandidate {
    name: string;
    command: string;
    buildArgs: (format: HostAudioFormat) => string[];
}

export interface SidPlaybackHarnessOptions {
    /**
     * Optional override for creating a SidAudioEngine. Defaults to instantiating with a shared WASM module.
     */
    createEngine?: () => Promise<SidAudioEngine>;
    /**
     * Optional override for spawning the host audio process. Defaults to child_process.spawn.
     */
    spawn?: SpawnFunction;
    /**
     * Optional override for reading SID files. Defaults to fs.readFile.
     */
    readSidFile?: (path: string) => Promise<Uint8Array>;
    /**
     * Duration in seconds for each PCM chunk rendered before piping to the host player (default: 0.25s).
     */
    chunkDurationSeconds?: number;
    /**
     * Cycles per chunk when rendering PCM (default: 20,000).
     */
    cyclesPerChunk?: number;
    /**
     * Host player candidates to attempt in order.
     */
    players?: HostPlayerCandidate[];
}

const DEFAULT_CHUNK_SECONDS = 0.25;
const DEFAULT_CYCLES_PER_CHUNK = 20_000;

const DEFAULT_PLAYERS: HostPlayerCandidate[] = [
    {
        name: "ffplay",
        command: "ffplay",
        buildArgs: (format) => [
            "-autoexit",
            "-nodisp",
            "-loglevel",
            "warning",
            "-f",
            "s16le",
            "-ar",
            String(format.sampleRate),
            "-ac",
            String(format.channels),
            "-i",
            "pipe:0"
        ]
    },
    {
        name: "aplay",
        command: "aplay",
        buildArgs: (format) => [
            "-q",
            "-f",
            format.channels === 2 ? "S16_LE" : "S16_LE",
            "-c",
            String(format.channels),
            "-r",
            String(format.sampleRate),
            "-t",
            "raw"
        ]
    }
];

let wasmModulePromise: Promise<LibsidplayfpWasmModule> | null = null;

async function defaultCreateEngine(): Promise<SidAudioEngine> {
    if (!wasmModulePromise) {
        wasmModulePromise = loadLibsidplayfp();
    }
    const module = await wasmModulePromise;
    return new SidAudioEngine({ module: Promise.resolve(module) });
}

async function defaultReadSidFile(path: string): Promise<Uint8Array> {
    const buffer = await readFile(path);
    return new Uint8Array(buffer);
}

export class SidPlaybackHarness {
    private readonly createEngine: () => Promise<SidAudioEngine>;
    private readonly spawn: SpawnFunction;
    private readonly readSidFile: (path: string) => Promise<Uint8Array>;
    private readonly chunkDuration: number;
    private readonly cyclesPerChunk: number;
    private readonly players: HostPlayerCandidate[];

    private enginePromise: Promise<SidAudioEngine> | null = null;
    private playerProcess: ChildProcess | null = null;
    private playerName: string | null = null;
    private state: PlaybackHarnessState = "idle";
    private samplesWritten = 0;
    private sampleRate = 44_100;
    private channels = 2;
    private offsetSeconds = 0;
    private durationSeconds?: number;
    private pumpPromise: Promise<void> | null = null;
    private stopRequested = false;
    private listeners: EventListenerMap = {
        started: new Set<(event: PlaybackStartResult) => void>(),
        finished: new Set<() => void>(),
        error: new Set<(error: Error) => void>()
    };

    constructor(options: SidPlaybackHarnessOptions = {}) {
        this.createEngine = options.createEngine ?? defaultCreateEngine;
        this.spawn = options.spawn ?? ((command, args, spawnOptions) =>
            defaultSpawn(command, [...args], spawnOptions)
        );
        this.readSidFile = options.readSidFile ?? defaultReadSidFile;
        this.chunkDuration = options.chunkDurationSeconds ?? DEFAULT_CHUNK_SECONDS;
        this.cyclesPerChunk = options.cyclesPerChunk ?? DEFAULT_CYCLES_PER_CHUNK;
        this.players = options.players ?? DEFAULT_PLAYERS;
    }

    on(event: "started", listener: (event: PlaybackStartResult) => void): void;
    on(event: "finished", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    on(event: PlaybackHarnessEvent, listener: unknown): void {
        if (event === "started") {
            this.listeners.started.add(listener as (event: PlaybackStartResult) => void);
            return;
        }
        if (event === "finished") {
            this.listeners.finished.add(listener as () => void);
            return;
        }
        if (event === "error") {
            this.listeners.error.add(listener as (error: Error) => void);
        }
    }

    off(event: "started", listener: (event: PlaybackStartResult) => void): void;
    off(event: "finished", listener: () => void): void;
    off(event: "error", listener: (error: Error) => void): void;
    off(event: PlaybackHarnessEvent, listener: unknown): void {
        if (event === "started") {
            this.listeners.started.delete(listener as (event: PlaybackStartResult) => void);
            return;
        }
        if (event === "finished") {
            this.listeners.finished.delete(listener as () => void);
            return;
        }
        if (event === "error") {
            this.listeners.error.delete(listener as (error: Error) => void);
        }
    }

    getState(): PlaybackHarnessState {
        return this.state;
    }

    getPositionSeconds(): number {
        if (!this.sampleRate || !this.channels) {
            return this.offsetSeconds;
        }
        const samplesPerSecond = this.sampleRate * this.channels;
        return this.offsetSeconds + this.samplesWritten / samplesPerSecond;
    }

    async start(options: PlaybackStartOptions): Promise<PlaybackStartResult> {
        await this.stopInternal();

        const engine = await this.ensureEngine();
        const sidBytes = await this.readSidFile(options.sidPath);
        await engine.loadSidBuffer(sidBytes);

        if (typeof options.songIndex === "number") {
            await engine.selectSong(options.songIndex);
        }

        if (typeof options.offsetSeconds === "number" && options.offsetSeconds > 0) {
            await engine.seekSeconds(options.offsetSeconds);
            this.offsetSeconds = options.offsetSeconds;
        } else {
            this.offsetSeconds = 0;
        }

        this.durationSeconds = options.durationSeconds;
        this.sampleRate = engine.getSampleRate();
        this.channels = engine.getChannels();
        this.samplesWritten = 0;
        this.stopRequested = false;

        await this.spawnHostPlayer();

        if (!this.playerProcess || !this.playerName) {
            throw new Error("Failed to launch host audio player");
        }

        this.state = "playing";
        const startedAt = new Date();
        const startResult: PlaybackStartResult = {
            pid: this.playerProcess.pid ?? undefined,
            command: this.playerName,
            startedAt,
            offsetSeconds: this.offsetSeconds,
            durationSeconds: this.durationSeconds
        };
        this.emit("started", startResult);

        this.pumpPromise = this.pumpAudio(engine).finally(() => {
            this.pumpPromise = null;
        });

        return startResult;
    }

    async pause(): Promise<void> {
        if (this.state !== "playing") {
            return;
        }
        this.state = "paused";
    }

    async resume(): Promise<void> {
        if (this.state !== "paused") {
            return;
        }
        this.state = "playing";
        if (!this.pumpPromise) {
            const engine = await this.ensureEngine();
            this.pumpPromise = this.pumpAudio(engine).finally(() => {
                this.pumpPromise = null;
            });
        }
    }

    async stop(): Promise<void> {
        await this.stopInternal(true);
    }

    private async stopInternal(killProcess = false): Promise<void> {
        this.stopRequested = true;
        const previousProcess = this.playerProcess;

        if (this.pumpPromise) {
            await this.pumpPromise.catch(() => undefined);
        }

        this.state = "idle";
        this.samplesWritten = 0;
        this.durationSeconds = undefined;
        this.offsetSeconds = 0;

        if (previousProcess) {
            try {
                if (killProcess && !previousProcess.killed) {
                    previousProcess.kill();
                }
                previousProcess.stdin?.end();
            } catch {
                // Ignore cleanup errors
            }
        }

        this.playerProcess = null;
        this.playerName = null;
    }

    private async ensureEngine(): Promise<SidAudioEngine> {
        if (!this.enginePromise) {
            this.enginePromise = this.createEngine();
        }
        return await this.enginePromise;
    }

    private emit(event: PlaybackHarnessEvent, payload?: unknown): void {
        if (event === "started") {
            for (const listener of this.listeners.started) {
                listener(payload as PlaybackStartResult);
            }
            return;
        }
        if (event === "finished") {
            for (const listener of this.listeners.finished) {
                listener();
            }
            return;
        }
        if (event === "error") {
            for (const listener of this.listeners.error) {
                listener(payload as Error);
            }
        }
    }

    private async spawnHostPlayer(): Promise<void> {
        const format: HostAudioFormat = {
            sampleRate: this.sampleRate,
            channels: this.channels
        };

        const failures: string[] = [];

        for (const candidate of this.players) {
            try {
                const child = this.spawn(candidate.command, candidate.buildArgs(format), {
                    stdio: ["pipe", "pipe", "pipe"]
                });

                const outcome = await Promise.race([
                    once(child, "spawn").then(() => ({ ok: true as const })),
                    once(child, "error").then(([error]) => ({ ok: false as const, error: error as Error }))
                ]);

                if (!outcome.ok) {
                    failures.push(`${candidate.command}: ${outcome.error.message}`);
                    continue;
                }

                if (!child.stdin || !child.stderr) {
                    failures.push(`${candidate.command}: player did not expose required stdio pipes`);
                    continue;
                }

                child.stdout?.setEncoding("utf8");
                child.stdout?.resume();
                child.stderr?.setEncoding("utf8");
                child.stderr?.on("data", () => {
                    // Suppress noisy player output in CLI environments
                });
                child.stderr?.resume();
                child.stdin?.on("error", (error: Error) => {
                    if (this.stopRequested) {
                        return;
                    }
                    this.emit("error", error);
                });
                child.once("close", (code) => {
                    if (this.playerProcess === child) {
                        this.playerProcess = null;
                        this.playerName = null;
                    }
                    if (this.stopRequested) {
                        return;
                    }
                    this.state = "idle";
                    if (code !== 0) {
                        this.emit("error", new Error(`${candidate.command} exited with code ${code}`));
                    } else {
                        this.emit("finished");
                    }
                });
                this.playerProcess = child;
                this.playerName = candidate.command;
                return;
            } catch (error) {
                failures.push(`${candidate.command}: ${(error as Error).message}`);
            }
        }

        throw new Error(`Unable to start host audio player. Tried: ${failures.join(", ") || "none"}`);
    }

    private async pumpAudio(engine: SidAudioEngine): Promise<void> {
        while (!this.stopRequested && this.state === "playing") {
            let chunk: Int16Array;
            try {
                chunk = await engine.renderSeconds(this.chunkDuration, this.cyclesPerChunk);
            } catch (error) {
                this.emit("error", error instanceof Error ? error : new Error(String(error)));
                break;
            }

            if (this.stopRequested || this.state !== "playing") {
                break;
            }

            if (!chunk || chunk.length === 0) {
                this.playerProcess?.stdin?.end();
                break;
            }

            await this.writeChunk(chunk);
            this.samplesWritten += chunk.length;
        }
    }

    private async writeChunk(chunk: Int16Array): Promise<void> {
        if (!this.playerProcess || !this.playerProcess.stdin) {
            return;
        }

        const buffer = Buffer.from(
            chunk.buffer,
            chunk.byteOffset,
            chunk.byteLength
        );

        if (!this.playerProcess.stdin.write(buffer)) {
            await once(this.playerProcess.stdin, "drain");
        }
    }
}
