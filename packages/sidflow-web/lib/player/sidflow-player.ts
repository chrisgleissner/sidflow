import loadLibsidplayfp, { SidAudioEngine } from '@sidflow/libsidplayfp-wasm';
import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { telemetry } from '@/lib/telemetry';
import { WorkletPlayer, type WorkletPlayerState } from '@/lib/audio/worklet-player';

/**
 * Enable the new AudioWorklet + SharedArrayBuffer pipeline.
 * When true, uses WorkletPlayer instead of the legacy AudioBuffer approach.
 */
const USE_WORKLET_PLAYER = true;

export type SidflowPlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

type SidflowPlayerEvent = 'statechange' | 'loadprogress' | 'error';

type EventPayloadMap = {
    statechange: SidflowPlayerState;
    loadprogress: number;
    error: Error;
};

interface LoadOptions {
    session: PlaybackSessionDescriptor;
    track: RateTrackInfo;
    signal?: AbortSignal;
}

type WasmModule = Awaited<ReturnType<typeof loadLibsidplayfp>>;

const INT16_SCALE = 1 / 0x8000;
const MIN_PLAYABLE_DURATION = 5;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Thin browser-side controller that loads SID files through SidAudioEngine,
 * converts rendered PCM buffers into AudioBuffers, and exposes basic playback controls.
 * 
 * Now delegates to WorkletPlayer when USE_WORKLET_PLAYER is true for real-time
 * AudioWorklet-based streaming with SharedArrayBuffer.
 */
export class SidflowPlayer {
    private readonly audioContext: AudioContext;
    private readonly gainNode: GainNode;
    private enginePromise: Promise<SidAudioEngine> | null = null;
    private bufferSource: AudioBufferSourceNode | null = null;
    private audioBuffer: AudioBuffer | null = null;
    private durationSeconds = 0;
    private startTime = 0;
    private pauseOffset = 0;
    private state: SidflowPlayerState = 'idle';
    private readonly listeners: Map<SidflowPlayerEvent, Set<(payload: EventPayloadMap[SidflowPlayerEvent]) => void>> =
        new Map();
    private currentSession: PlaybackSessionDescriptor | null = null;
    private currentTrack: RateTrackInfo | null = null;

    // New worklet-based player
    private workletPlayer: WorkletPlayer | null = null;

    constructor(context?: AudioContext) {
        this.audioContext = context ?? new AudioContext();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.listeners.set('statechange', new Set());
        this.listeners.set('loadprogress', new Set());
        this.listeners.set('error', new Set());

        // Initialize worklet player if enabled
        if (USE_WORKLET_PLAYER) {
            this.workletPlayer = new WorkletPlayer(this.audioContext);
            // Forward events from worklet player
            this.workletPlayer.on('statechange', (state) => {
                this.state = state as SidflowPlayerState;
                this.emit('statechange', state as SidflowPlayerState);
            });
            this.workletPlayer.on('loadprogress', (progress) => {
                this.emit('loadprogress', progress);
            });
            this.workletPlayer.on('error', (error) => {
                this.emit('error', error);
            });
        }
    }

    on<Event extends SidflowPlayerEvent>(event: Event, listener: (payload: EventPayloadMap[Event]) => void): void {
        this.listeners.get(event)?.add(listener as never);
    }

    off<Event extends SidflowPlayerEvent>(event: Event, listener: (payload: EventPayloadMap[Event]) => void): void {
        this.listeners.get(event)?.delete(listener as never);
    }

    getState(): SidflowPlayerState {
        return this.state;
    }

    getSession(): PlaybackSessionDescriptor | null {
        return this.currentSession;
    }

    getTrack(): RateTrackInfo | null {
        return this.currentTrack;
    }

    getDurationSeconds(): number {
        // Delegate to worklet player if enabled
        if (USE_WORKLET_PLAYER && this.workletPlayer) {
            return this.workletPlayer.getDurationSeconds();
        }

        // Legacy implementation
        if (this.audioBuffer) {
            return this.audioBuffer.duration;
        }
        return this.durationSeconds;
    }

    getPositionSeconds(): number {
        // Delegate to worklet player if enabled
        if (USE_WORKLET_PLAYER && this.workletPlayer) {
            return this.workletPlayer.getPositionSeconds();
        }

        // Legacy implementation
        if (!this.audioBuffer) {
            return 0;
        }
        if (this.state === 'playing') {
            const elapsed = this.audioContext.currentTime - this.startTime;
            return clamp(this.pauseOffset + elapsed, 0, this.audioBuffer.duration);
        }
        return clamp(this.pauseOffset, 0, this.audioBuffer.duration);
    }

    async load(options: LoadOptions): Promise<void> {
        // Delegate to worklet player if enabled
        if (USE_WORKLET_PLAYER && this.workletPlayer) {
            this.currentSession = options.session;
            this.currentTrack = options.track;
            return this.workletPlayer.load(options);
        }

        // Legacy implementation
        const { session, track, signal } = options;
        this.stopPlayback();
        this.audioBuffer = null;
        this.durationSeconds = 0;
        this.pauseOffset = 0;
        this.currentSession = session;
        this.currentTrack = track;
        this.updateState('loading');

        const loadStartTime = performance.now();
        telemetry.trackPlaybackLoad({
            sessionId: session.sessionId,
            sidPath: track.sidPath,
            status: 'start',
        });

        try {
            const engine = await this.ensureEngine();
            this.throwIfAborted(signal);

            const response = await fetch(session.sidUrl, {
                method: 'GET',
                headers: {
                    Accept: 'application/octet-stream',
                },
                signal,
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch SID file (${response.status})`);
            }

            const sidBytes = new Uint8Array(await response.arrayBuffer());
            this.throwIfAborted(signal);

            await engine.loadSidBuffer(sidBytes);
            this.throwIfAborted(signal);

            if (session.selectedSong > 0) {
                await engine.selectSong(session.selectedSong - 1);
                this.throwIfAborted(signal);
            }

            const sampleRate = engine.getSampleRate();
            const channels = engine.getChannels();
            const targetDuration = Math.max(
                MIN_PLAYABLE_DURATION,
                session.durationSeconds || track.durationSeconds || MIN_PLAYABLE_DURATION
            );
            const totalSamplesEstimate = Math.max(1, Math.floor(sampleRate * channels * targetDuration));

            // Render with minimal progress tracking overhead (throttled updates)
            // Use larger chunks (40000 cycles) to reduce WASM call overhead
            let lastProgress = 0;
            let lastProgressTime = 0;
            const pcm = await engine.renderSeconds(targetDuration, 40000, (samplesWritten: number) => {
                if (!this.audioBuffer && totalSamplesEstimate > 0) {
                    const now = performance.now();
                    // Only emit progress updates every 100ms to reduce overhead
                    if (now - lastProgressTime >= 100) {
                        const progress = clamp(samplesWritten / totalSamplesEstimate, 0, 0.999);
                        if (progress - lastProgress >= 0.01) {
                            lastProgress = progress;
                            lastProgressTime = now;
                            this.emit('loadprogress', progress);
                        }
                    }
                }
            });
            this.throwIfAborted(signal);

            const frames = Math.floor(pcm.length / channels);
            const buffer = this.audioContext.createBuffer(channels, frames, sampleRate);

            // Convert with chunked processing to avoid blocking main thread
            const CHUNK_SIZE = 44100; // Process 1 second at a time
            if (channels === 2) {
                // Stereo fast path - most common case
                const leftChannel = buffer.getChannelData(0);
                const rightChannel = buffer.getChannelData(1);
                for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
                    const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);
                    for (let frame = startFrame; frame < endFrame; frame += 1) {
                        const idx = frame * 2;
                        leftChannel[frame] = pcm[idx] * INT16_SCALE;
                        rightChannel[frame] = pcm[idx + 1] * INT16_SCALE;
                    }
                    // Yield to event loop every second of audio
                    if (endFrame < frames) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                        this.throwIfAborted(signal);
                    }
                }
            } else {
                // Mono or multi-channel fallback
                for (let channel = 0; channel < channels; channel += 1) {
                    const channelData = buffer.getChannelData(channel);
                    for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
                        const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);
                        for (let frame = startFrame; frame < endFrame; frame += 1) {
                            channelData[frame] = pcm[frame * channels + channel] * INT16_SCALE;
                        }
                        // Yield to event loop every second of audio
                        if (endFrame < frames) {
                            await new Promise(resolve => setTimeout(resolve, 0));
                            this.throwIfAborted(signal);
                        }
                    }
                }
            }

            this.audioBuffer = buffer;
            this.durationSeconds = buffer.duration;
            this.pauseOffset = 0;
            this.emit('loadprogress', 1);
            this.updateState('ready');

            const loadEndTime = performance.now();
            telemetry.trackPlaybackLoad({
                sessionId: session.sessionId,
                sidPath: track.sidPath,
                status: 'success',
                metrics: {
                    loadDurationMs: loadEndTime - loadStartTime,
                    trackDurationSeconds: buffer.duration,
                    fileSizeBytes: sidBytes.length,
                },
            });
        } catch (error) {
            if (signal?.aborted) {
                this.updateState('idle');
                return;
            }
            this.updateState('idle');
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.emit('error', errorObj);

            telemetry.trackPlaybackLoad({
                sessionId: session.sessionId,
                sidPath: track.sidPath,
                status: 'error',
                error: errorObj,
            });

            throw error;
        }
    }

    async play(): Promise<void> {
        // Delegate to worklet player if enabled
        if (USE_WORKLET_PLAYER && this.workletPlayer) {
            return this.workletPlayer.play();
        }

        // Legacy implementation
        if (!this.audioBuffer) {
            return;
        }

        await this.audioContext.resume().catch((error) => {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        });

        this.stopPlayback();
        const source = this.audioContext.createBufferSource();
        source.buffer = this.audioBuffer;
        source.connect(this.gainNode);
        source.onended = () => {
            if (this.bufferSource !== source) {
                return;
            }
            this.bufferSource = null;
            this.pauseOffset = 0;
            this.updateState('ended');
        };

        const offset = clamp(this.pauseOffset, 0, this.audioBuffer.duration);
        source.start(0, offset);
        this.bufferSource = source;
        this.startTime = this.audioContext.currentTime - offset;
        this.updateState('playing');
    }

    pause(): void {
        // Delegate to worklet player if enabled
        if (USE_WORKLET_PLAYER && this.workletPlayer) {
            this.workletPlayer.pause();
            return;
        }

        // Legacy implementation
        if (!this.audioBuffer || !this.bufferSource || this.state !== 'playing') {
            return;
        }
        const elapsed = this.audioContext.currentTime - this.startTime;
        this.pauseOffset = clamp(elapsed, 0, this.audioBuffer.duration);
        this.stopPlayback();
        this.updateState('paused');
    }

    stop(): void {
        // Delegate to worklet player if enabled
        if (USE_WORKLET_PLAYER && this.workletPlayer) {
            this.workletPlayer.stop();
            return;
        }

        // Legacy implementation
        this.pauseOffset = 0;
        this.stopPlayback();
        this.updateState('idle');
    }

    seek(seconds: number): void {
        // Seek disabled in worklet player (as per requirements)
        if (USE_WORKLET_PLAYER) {
            console.warn('[SidflowPlayer] Seek not supported in worklet mode');
            return;
        }

        // Legacy implementation
        if (!this.audioBuffer) {
            return;
        }
        const clamped = clamp(seconds, 0, this.audioBuffer.duration);
        this.pauseOffset = clamped;
        if (this.state === 'playing') {
            this.play().catch((error) => {
                this.emit('error', error instanceof Error ? error : new Error(String(error)));
            });
        }
    }

    destroy(): void {
        // Delegate to worklet player if enabled
        if (USE_WORKLET_PLAYER && this.workletPlayer) {
            this.workletPlayer.destroy();
            return;
        }

        // Legacy implementation
        this.stopPlayback();
        this.audioBuffer = null;
        this.currentSession = null;
        this.currentTrack = null;
        this.updateState('idle');
        void this.audioContext.close().catch(() => undefined);
    }

    private async ensureEngine(): Promise<SidAudioEngine> {
        if (!this.enginePromise) {
            this.enginePromise = loadLibsidplayfp({
                locateFile: (asset: string) => `/wasm/${asset}`,
            }).then(
                (module: WasmModule) => new SidAudioEngine({ module: Promise.resolve(module) }),
                (error) => {
                    console.error('[SidflowPlayer] WASM module load failed:', error);
                    throw error;
                }
            );
        }
        return this.enginePromise;
    }

    private stopPlayback(): void {
        if (this.bufferSource) {
            try {
                this.bufferSource.onended = null;
                this.bufferSource.stop();
            } catch {
                // Ignore
            }
            try {
                this.bufferSource.disconnect();
            } catch {
                // Ignore
            }
            this.bufferSource = null;
        }
    }

    private updateState(next: SidflowPlayerState): void {
        if (this.state === next) {
            return;
        }
        const oldState = this.state;
        this.state = next;
        this.emit('statechange', next);

        telemetry.trackPlaybackStateChange({
            sessionId: this.currentSession?.sessionId,
            sidPath: this.currentTrack?.sidPath,
            oldState,
            newState: next,
            positionSeconds: this.getPositionSeconds(),
        });
    }

    private emit<Event extends SidflowPlayerEvent>(event: Event, payload: EventPayloadMap[Event]): void {
        const listeners = this.listeners.get(event);
        if (!listeners || listeners.size === 0) {
            return;
        }
        for (const listener of listeners) {
            try {
                (listener as (data: EventPayloadMap[Event]) => void)(payload);
            } catch (
            error
            ) {
                if (event !== 'error') {
                    this.emit('error', error instanceof Error ? error : new Error(String(error)));
                }
            }
        }
    }

    private throwIfAborted(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw new DOMException('Playback load aborted', 'AbortError');
        }
    }
}

export default SidflowPlayer;
