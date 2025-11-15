import Hls, { Events as HlsEvents, ErrorTypes as HlsErrorTypes, type ErrorData as HlsErrorData } from 'hls.js';
import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import type { TelemetryData } from '@/lib/audio/worklet-player';

type HlsPlayerEvent = 'statechange' | 'loadprogress' | 'error';

type HlsPlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

type EventPayloadMap = {
    statechange: HlsPlayerState;
    loadprogress: number;
    error: Error;
};

interface LoadOptions {
    session: PlaybackSessionDescriptor;
    track: RateTrackInfo;
    signal?: AbortSignal;
}

const DEFAULT_TELEMETRY: TelemetryData = {
    underruns: 0,
    framesConsumed: 0,
    framesProduced: 0,
    backpressureStalls: 0,
    minOccupancy: 0,
    maxOccupancy: 0,
    zeroByteFrames: 0,
    missedQuanta: 0,
    avgDriftMs: 0,
    maxDriftMs: 0,
    contextSuspendCount: 0,
    contextResumeCount: 0,
    renderMaxDurationMs: 0,
    renderAvgDurationMs: 0,
    ringBufferCapacityFrames: 0,
};

function createAudioElement(): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null;
    }
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.controls = false;
    return audio;
}

export class HlsPlayer {
    private readonly audio: HTMLAudioElement | null;
    private hls: Hls | null = null;
    private state: HlsPlayerState = 'idle';
    private readonly listeners: Map<HlsPlayerEvent, Set<(payload: EventPayloadMap[HlsPlayerEvent]) => void>> = new Map();
    private currentSession: PlaybackSessionDescriptor | null = null;
    private currentTrack: RateTrackInfo | null = null;

    private readonly handlePlaying = () => {
        if (this.state !== 'playing') {
            this.updateState('playing');
        }
    };

    private readonly handlePause = () => {
        if (!this.audio) {
            return;
        }
        if (this.audio.ended) {
            return;
        }
        if (this.state === 'paused' || this.state === 'loading') {
            return;
        }
        this.updateState('paused');
    };

    private readonly handleEnded = () => {
        this.updateState('ended');
    };

    private readonly handleAudioError = () => {
        const error = new Error('HLS audio element reported an error');
        this.updateState('error');
        this.emit('error', error);
    };

    constructor() {
        this.listeners.set('statechange', new Set());
        this.listeners.set('loadprogress', new Set());
        this.listeners.set('error', new Set());

        this.audio = createAudioElement();

        if (this.audio) {
            this.audio.addEventListener('playing', this.handlePlaying);
            this.audio.addEventListener('pause', this.handlePause);
            this.audio.addEventListener('ended', this.handleEnded);
            this.audio.addEventListener('error', this.handleAudioError);
        }
    }

    static isSupported(): boolean {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return false;
        }
        if (Hls.isSupported()) {
            return true;
        }
        const audio = document.createElement('audio');
        const support = audio.canPlayType('application/vnd.apple.mpegurl');
        return support === 'probably' || support === 'maybe';
    }

    on<Event extends HlsPlayerEvent>(event: Event, listener: (payload: EventPayloadMap[Event]) => void): void {
        this.listeners.get(event)?.add(listener as never);
    }

    off<Event extends HlsPlayerEvent>(event: Event, listener: (payload: EventPayloadMap[Event]) => void): void {
        this.listeners.get(event)?.delete(listener as never);
    }

    getState(): HlsPlayerState {
        return this.state;
    }

    getSession(): PlaybackSessionDescriptor | null {
        return this.currentSession;
    }

    getTrack(): RateTrackInfo | null {
        return this.currentTrack;
    }

    getDurationSeconds(): number {
        if (this.audio && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
            return this.audio.duration;
        }
        return this.currentTrack?.durationSeconds ?? 0;
    }

    getPositionSeconds(): number {
        if (this.audio && Number.isFinite(this.audio.currentTime)) {
            return this.audio.currentTime;
        }
        return 0;
    }

    getTelemetry(): TelemetryData {
        return { ...DEFAULT_TELEMETRY };
    }

    enableCapture(): void {
        // Capture not supported in HLS fallback mode.
    }

    getCapturedAudio(): Blob | null {
        return null;
    }

    async getCapturedPCM(): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
        return null;
    }

    async load(options: LoadOptions): Promise<void> {
        if (!this.audio) {
            throw new Error('Audio element unavailable in this environment');
        }

        const { session, track, signal } = options;
        if (!session.fallbackHlsUrl) {
            throw new Error('No fallback HLS URL provided for session');
        }

        this.stop();
        this.currentSession = session;
        this.currentTrack = track;
        this.audio.src = '';
        this.audio.removeAttribute('src');
        this.detachHls();
        this.updateState('loading');
        this.emit('loadprogress', 0);

        if (signal?.aborted) {
            this.updateState('idle');
            throw new DOMException('Playback load aborted', 'AbortError');
        }

        const controller = new AbortController();
        const onAbort = () => {
            controller.abort();
            this.stop();
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
            await this.initializeSource(session.fallbackHlsUrl, controller.signal);
            this.emit('loadprogress', 1);
            this.updateState('ready');
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }
    }

    async play(): Promise<void> {
        if (!this.audio) {
            return;
        }
        try {
            await this.audio.play();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.updateState('error');
            this.emit('error', err);
            throw err;
        }
    }

    pause(): void {
        if (!this.audio) {
            return;
        }
        this.audio.pause();
    }

    stop(): void {
        if (!this.audio) {
            return;
        }
        if (!this.audio.paused) {
            this.audio.pause();
        }
        if (Number.isFinite(this.audio.currentTime)) {
            try {
                this.audio.currentTime = 0;
            } catch {
                // Some browsers throw when resetting currentTime for live streams; ignore.
            }
        }
        this.updateState('idle');
    }

    /**
     * Set the playback volume (0.0 to 1.0)
     * @param volume - Volume level from 0.0 (silent) to 1.0 (full)
     */
    setVolume(volume: number): void {
        if (!this.audio) {
            return;
        }
        const clamped = Math.min(1, Math.max(0, volume));
        this.audio.volume = clamped;
    }

    /**
     * Get the current playback volume (0.0 to 1.0)
     * @returns Current volume level
     */
    getVolume(): number {
        return this.audio?.volume ?? 1.0;
    }

    destroy(): void {
        this.stop();
        this.detachHls();
        if (this.audio) {
            this.audio.removeEventListener('playing', this.handlePlaying);
            this.audio.removeEventListener('pause', this.handlePause);
            this.audio.removeEventListener('ended', this.handleEnded);
            this.audio.removeEventListener('error', this.handleAudioError);
            this.audio.src = '';
            this.audio.removeAttribute('src');
        }
        this.listeners.forEach((set) => set.clear());
    }

    private updateState(next: HlsPlayerState): void {
        if (this.state === next) {
            return;
        }
        this.state = next;
        this.emit('statechange', next);
    }

    private emit<Event extends HlsPlayerEvent>(event: Event, payload: EventPayloadMap[Event]): void {
        const listeners = this.listeners.get(event);
        if (!listeners || listeners.size === 0) {
            return;
        }
        for (const listener of listeners) {
            try {
                (listener as (value: EventPayloadMap[Event]) => void)(payload);
            } catch (error) {
                if (event !== 'error') {
                    const err = error instanceof Error ? error : new Error(String(error));
                    this.emit('error', err);
                }
            }
        }
    }

    private async initializeSource(url: string, signal: AbortSignal): Promise<void> {
        if (!this.audio) {
            throw new Error('Audio element unavailable');
        }

        if (Hls.isSupported()) {
            await this.initializeWithHlsJs(url, signal);
            return;
        }

        await this.initializeNative(url, signal);
    }

    private async initializeWithHlsJs(url: string, signal: AbortSignal): Promise<void> {
        if (!this.audio) {
            throw new Error('Audio element unavailable');
        }

        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        this.hls = hls;

        await new Promise<void>((resolve, reject) => {
            const handleManifestParsed = () => {
                cleanup();
                resolve();
            };

            const handleError = (...args: unknown[]) => {
                const data = args[1] as HlsErrorData | undefined;
                if (!data) {
                    return;
                }
                if (data.fatal) {
                    cleanup();
                    reject(new Error(`Fatal HLS.js error: ${data.type} ${data.details ?? ''}`));
                    return;
                }
                if (data.type === HlsErrorTypes.NETWORK_ERROR) {
                    hls.startLoad();
                } else if (data.type === HlsErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                }
            };

            const handleAbort = () => {
                cleanup();
                reject(new DOMException('Playback load aborted', 'AbortError'));
            };

            const cleanup = () => {
                hls.off(HlsEvents.MANIFEST_PARSED, handleManifestParsed);
                hls.off(HlsEvents.ERROR, handleError);
                signal.removeEventListener('abort', handleAbort);
            };

            signal.addEventListener('abort', handleAbort, { once: true });
            hls.on(HlsEvents.MANIFEST_PARSED, handleManifestParsed);
            hls.on(HlsEvents.ERROR, handleError);

            hls.attachMedia(this.audio!);
            hls.on(HlsEvents.MEDIA_ATTACHED, () => {
                try {
                    hls.loadSource(url);
                } catch (error) {
                    cleanup();
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        });
    }

    private async initializeNative(url: string, signal: AbortSignal): Promise<void> {
        const audio = this.audio;
        if (!audio) {
            throw new Error('Audio element unavailable');
        }

        await new Promise<void>((resolve, reject) => {
            const handleLoadedMetadata = () => {
                cleanup();
                resolve();
            };

            const handleError = () => {
                cleanup();
                reject(new Error('Failed to load HLS stream via native playback'));
            };

            const handleAbort = () => {
                cleanup();
                reject(new DOMException('Playback load aborted', 'AbortError'));
            };

            const cleanup = () => {
                audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
                audio.removeEventListener('error', handleError);
                signal.removeEventListener('abort', handleAbort);
            };

            signal.addEventListener('abort', handleAbort, { once: true });
            audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
            audio.addEventListener('error', handleError, { once: true });
            try {
                audio.src = url;
                audio.load();
            } catch (error) {
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private detachHls(): void {
        if (this.hls) {
            try {
                this.hls.destroy();
            } catch {
                // Ignore teardown errors
            }
            this.hls = null;
        }
    }
}
