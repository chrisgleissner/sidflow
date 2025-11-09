import loadLibsidplayfp, { SidAudioEngine } from '@sidflow/libsidplayfp-wasm';
import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';

export type SidflowPlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended';

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

    constructor(context?: AudioContext) {
        this.audioContext = context ?? new AudioContext();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.listeners.set('statechange', new Set());
        this.listeners.set('loadprogress', new Set());
        this.listeners.set('error', new Set());
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
        if (this.audioBuffer) {
            return this.audioBuffer.duration;
        }
        return this.durationSeconds;
    }

    getPositionSeconds(): number {
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
        const { session, track, signal } = options;
        this.stopPlayback();
        this.audioBuffer = null;
        this.durationSeconds = 0;
        this.pauseOffset = 0;
        this.currentSession = session;
        this.currentTrack = track;
        this.updateState('loading');

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

            let lastProgress = 0;
            const pcm = await engine.renderSeconds(targetDuration, 20000, (samplesWritten: number) => {
                if (!this.audioBuffer && totalSamplesEstimate > 0) {
                    const progress = clamp(samplesWritten / totalSamplesEstimate, 0, 0.999);
                    if (progress - lastProgress >= 0.01) {
                        lastProgress = progress;
                        this.emit('loadprogress', progress);
                    }
                }
            });
            this.throwIfAborted(signal);

            const frames = Math.floor(pcm.length / channels);
            const buffer = this.audioContext.createBuffer(channels, frames, sampleRate);

            for (let channel = 0; channel < channels; channel += 1) {
                const channelData = buffer.getChannelData(channel);
                for (let frame = 0; frame < frames; frame += 1) {
                    const sampleIndex = frame * channels + channel;
                    channelData[frame] = pcm[sampleIndex] * INT16_SCALE;
                }
            }

            this.audioBuffer = buffer;
            this.durationSeconds = buffer.duration;
            this.pauseOffset = 0;
            this.emit('loadprogress', 1);
            this.updateState('ready');
        } catch (error) {
            if (signal?.aborted) {
                this.updateState('idle');
                return;
            }
            this.updateState('idle');
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async play(): Promise<void> {
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
        if (!this.audioBuffer || !this.bufferSource || this.state !== 'playing') {
            return;
        }
        const elapsed = this.audioContext.currentTime - this.startTime;
        this.pauseOffset = clamp(elapsed, 0, this.audioBuffer.duration);
        this.stopPlayback();
        this.updateState('paused');
    }

    stop(): void {
        this.pauseOffset = 0;
        this.stopPlayback();
        this.updateState('idle');
    }

    seek(seconds: number): void {
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
                (module: WasmModule) => new SidAudioEngine({ module: Promise.resolve(module) })
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
        this.state = next;
        this.emit('statechange', next);
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
