import loadLibsidplayfp, { SidAudioEngine } from '@sidflow/libsidplayfp-wasm';
import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { telemetry } from '@/lib/telemetry';
import { recordImplicitAction } from '@/lib/feedback/recorder';
import { WorkletPlayer, type WorkletPlayerState, type TelemetryData } from '@/lib/audio/worklet-player';
import { HlsPlayer } from '@/lib/audio/hls-player';
import { fetchRomAssets } from '@/lib/audio/fetch-rom-assets';

interface WorkletSupportOverrides {
    window?: {
        crossOriginIsolated?: boolean;
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
    } | null;
    sharedArrayBuffer?: unknown;
}

export interface WorkletSupportResult {
    supported: boolean;
    reasons: string[];
}

export function detectWorkletSupport(overrides: WorkletSupportOverrides = {}): WorkletSupportResult {
    const scopedWindow = overrides.window !== undefined
        ? overrides.window ?? undefined
        : (typeof window !== 'undefined' ? window : undefined);

    if (!scopedWindow) {
        return { supported: true, reasons: [] };
    }

    const reasons: string[] = [];

    if (scopedWindow.crossOriginIsolated !== true) {
        reasons.push('cross-origin-isolation-disabled');
    }

    const sharedArrayBuffer = Object.prototype.hasOwnProperty.call(overrides, 'sharedArrayBuffer')
        ? overrides.sharedArrayBuffer
        : (typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : undefined);

    if (typeof sharedArrayBuffer === 'undefined') {
        reasons.push('missing-shared-array-buffer');
    }

    const AudioContextCtor = overrides.window?.AudioContext
        ?? (scopedWindow as unknown as { AudioContext?: typeof AudioContext }).AudioContext
        ?? overrides.window?.webkitAudioContext
        ?? (scopedWindow as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
        reasons.push('missing-audio-context');
    } else {
        const prototype = AudioContextCtor.prototype;
        const hasAudioWorklet = Boolean(
            prototype && ('audioWorklet' in prototype || Object.getOwnPropertyDescriptor(prototype, 'audioWorklet'))
        );

        if (!hasAudioWorklet) {
            reasons.push('missing-audio-worklet');
        }
    }

    return {
        supported: reasons.length === 0,
        reasons,
    };
}

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
const CROSSFADE_STOP_EPSILON = 0.05;

interface LegacyPlaybackNode {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Thin browser-side controller that loads SID files through SidAudioEngine,
 * converts rendered PCM buffers into AudioBuffers, and exposes basic playback controls.
 * 
 * Delegates to WorkletPlayer when AudioWorklet + SharedArrayBuffer are supported;
 * otherwise falls back to buffering PCM on the main thread.
 */
export class SidflowPlayer {
    private readonly audioContext: AudioContext;
    private readonly gainNode: GainNode;
    private enginePromise: Promise<SidAudioEngine> | null = null;
    private bufferSource: LegacyPlaybackNode | null = null;
    private audioBuffer: AudioBuffer | null = null;
    private durationSeconds = 0;
    private startTime = 0;
    private pauseOffset = 0;
    private state: SidflowPlayerState = 'idle';
    private readonly listeners: Map<SidflowPlayerEvent, Set<(payload: EventPayloadMap[SidflowPlayerEvent]) => void>> =
        new Map();
    private currentSession: PlaybackSessionDescriptor | null = null;
    private currentTrack: RateTrackInfo | null = null;
    private readonly useWorkletPlayer: boolean;
    private readonly workletFallbackReasons: string[];

    // New worklet-based player
    private workletPlayer: WorkletPlayer | null = null;
    private hlsPlayer: HlsPlayer | null = null;
    private activePipeline: 'worklet' | 'legacy' | 'hls' = 'legacy';
    private readonly fadingSources: Set<LegacyPlaybackNode> = new Set();
    private pendingCrossfade = false;
    private crossfadeDurationSeconds = 0;

    constructor(context?: AudioContext) {
        const AudioContextCtor = typeof AudioContext !== 'undefined'
            ? AudioContext
            : (typeof window !== 'undefined'
                ? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
                : undefined);

        const resolvedContext = context ?? (AudioContextCtor ? new AudioContextCtor() : null);
        if (!resolvedContext) {
            throw new Error('AudioContext is not supported in this environment');
        }

        this.audioContext = resolvedContext;
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.listeners.set('statechange', new Set());
        this.listeners.set('loadprogress', new Set());
        this.listeners.set('error', new Set());

        const support = detectWorkletSupport();
        this.useWorkletPlayer = support.supported;
        this.workletFallbackReasons = support.reasons;

        if (!this.useWorkletPlayer && support.reasons.length > 0) {
            console.warn('[SidflowPlayer] AudioWorklet pipeline disabled; falling back to legacy playback', {
                reasons: support.reasons,
            });
            telemetry.trackPlaybackFallback({
                reason: support.reasons[0] ?? 'worklet-unsupported',
                fallbackType: 'legacy-buffer',
                metadata: {
                    reasons: support.reasons,
                    crossOriginIsolated: typeof window !== 'undefined' ? window.crossOriginIsolated : undefined,
                    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
                },
            });
        }

        // Initialize worklet player if enabled
        if (this.useWorkletPlayer) {
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

        this.activePipeline = this.useWorkletPlayer ? 'worklet' : 'legacy';
    }

    getPipelineKind(): 'worklet' | 'legacy' | 'hls' {
        return this.activePipeline;
    }

    getWorkletFallbackReasons(): readonly string[] {
        return [...this.workletFallbackReasons];
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
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            return this.workletPlayer.getDurationSeconds();
        }
        if (this.activePipeline === 'hls' && this.hlsPlayer) {
            return this.hlsPlayer.getDurationSeconds();
        }

        if (this.audioBuffer) {
            return this.audioBuffer.duration;
        }
        return this.durationSeconds;
    }

    getPositionSeconds(): number {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            return this.workletPlayer.getPositionSeconds();
        }
        if (this.activePipeline === 'hls' && this.hlsPlayer) {
            return this.hlsPlayer.getPositionSeconds();
        }

        if (!this.audioBuffer) {
            return 0;
        }
        if (this.state === 'playing') {
            const elapsed = this.audioContext.currentTime - this.startTime;
            return clamp(this.pauseOffset + elapsed, 0, this.audioBuffer.duration);
        }
        return clamp(this.pauseOffset, 0, this.audioBuffer.duration);
    }

    /**
     * Enable audio capture for testing/analysis (worklet mode only).
     * Must be called before play().
     */
    enableCapture(): void {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            this.workletPlayer.enableCapture();
        }
    }

    /**
     * Get captured audio data (worklet mode only).
     */
    getCapturedAudio(): Blob | null {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            return this.workletPlayer.getCapturedAudio();
        }
        return null;
    }

    /**
     * Get captured audio as PCM for analysis (worklet mode only).
     */
    async getCapturedPCM(): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            return this.workletPlayer.getCapturedPCM();
        }
        return null;
    }

    /**
     * Get telemetry data (worklet mode only).
     */
    getTelemetry(): TelemetryData {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            return this.workletPlayer.getTelemetry();
        }
        if (this.activePipeline === 'hls' && this.hlsPlayer) {
            return this.hlsPlayer.getTelemetry();
        }
        return {
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
    }

    async load(options: LoadOptions): Promise<void> {
        const { session, track } = options;

        const previousTrack = this.currentTrack;
        const previousSession = this.currentSession;
        const previousPipeline = this.activePipeline;
        const previousState = this.state;

        if (
            previousTrack &&
            previousTrack.sidPath !== track.sidPath &&
            (previousState === 'playing' || previousState === 'paused')
        ) {
            recordImplicitAction({
                track: previousTrack,
                action: 'skip',
                sessionId: previousSession?.sessionId,
                pipeline: previousPipeline,
                metadata: {
                    reason: 'load-new-track',
                    nextSidPath: track.sidPath,
                },
            });
        }

        this.currentSession = session;
        this.currentTrack = track;

        const pipeline = this.determinePipeline(session);
        this.activePipeline = pipeline;

        const shouldCrossfade = pipeline === 'legacy'
            && this.crossfadeDurationSeconds > 0
            && this.bufferSource !== null
            && this.state === 'playing';

        this.pendingCrossfade = shouldCrossfade;

        if (!shouldCrossfade) {
            this.stopLegacyPlayback();
        }
        try {
            this.workletPlayer?.stop();
        } catch {
            // ignore stop errors
        }
        if (this.hlsPlayer) {
            this.hlsPlayer.stop();
        }

        if (pipeline === 'worklet' && this.workletPlayer) {
            await this.workletPlayer.load(options);
            return;
        }

        if (pipeline === 'hls') {
            await this.loadHls(options);
            return;
        }

        await this.loadLegacy(options);
    }

    private async loadLegacy(options: LoadOptions): Promise<void> {
        const { session, track, signal } = options;

        this.audioBuffer = null;
        this.durationSeconds = 0;
        this.pauseOffset = 0;

        if (this.workletFallbackReasons.length > 0) {
            telemetry.trackPlaybackFallback({
                sessionId: session.sessionId,
                sidPath: track.sidPath,
                reason: this.workletFallbackReasons[0] ?? 'worklet-unsupported',
                fallbackType: 'legacy-buffer',
                metadata: {
                    reasons: this.workletFallbackReasons,
                },
            });
        }
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

            const romAssets = await fetchRomAssets(session, signal);
            this.throwIfAborted(signal);

            await engine.setSystemROMs(
                romAssets.kernal ?? null,
                romAssets.basic ?? null,
                romAssets.chargen ?? null
            );
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
            let lastProgressTime = 0;
            const pcm = await engine.renderSeconds(targetDuration, 40000, (samplesWritten: number) => {
                if (!this.audioBuffer && totalSamplesEstimate > 0) {
                    const now = performance.now();
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

            const CHUNK_SIZE = 44100;
            if (channels === 2) {
                const leftChannel = buffer.getChannelData(0);
                const rightChannel = buffer.getChannelData(1);
                for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
                    const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);
                    for (let frame = startFrame; frame < endFrame; frame += 1) {
                        const idx = frame * 2;
                        leftChannel[frame] = pcm[idx] * INT16_SCALE;
                        rightChannel[frame] = pcm[idx + 1] * INT16_SCALE;
                    }
                    if (endFrame < frames) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                        this.throwIfAborted(signal);
                    }
                }
            } else {
                for (let channel = 0; channel < channels; channel += 1) {
                    const channelData = buffer.getChannelData(channel);
                    for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
                        const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);
                        for (let frame = startFrame; frame < endFrame; frame += 1) {
                            channelData[frame] = pcm[frame * channels + channel] * INT16_SCALE;
                        }
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

            throw errorObj;
        }
    }

    private async loadHls(options: LoadOptions): Promise<void> {
        const { session, track, signal } = options;
        const player = this.ensureHlsPlayer();

        if (!session.fallbackHlsUrl) {
            throw new Error('No fallback HLS URL provided for session');
        }

        this.durationSeconds = track.durationSeconds;
        this.pauseOffset = 0;

        if (this.workletFallbackReasons.length > 0) {
            telemetry.trackPlaybackFallback({
                sessionId: session.sessionId,
                sidPath: track.sidPath,
                reason: this.workletFallbackReasons[0] ?? 'worklet-unsupported',
                fallbackType: 'hls',
                metadata: {
                    reasons: this.workletFallbackReasons,
                },
            });
        }

        const loadStartTime = performance.now();
        telemetry.trackPlaybackLoad({
            sessionId: session.sessionId,
            sidPath: track.sidPath,
            status: 'start',
        });

        try {
            await player.load(options);
            const loadEndTime = performance.now();
            telemetry.trackPlaybackLoad({
                sessionId: session.sessionId,
                sidPath: track.sidPath,
                status: 'success',
                metrics: {
                    loadDurationMs: loadEndTime - loadStartTime,
                    trackDurationSeconds: track.durationSeconds,
                },
            });
        } catch (error) {
            if (signal?.aborted) {
                this.updateState('idle');
                return;
            }
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.updateState('idle');
            this.emit('error', errorObj);

            telemetry.trackPlaybackLoad({
                sessionId: session.sessionId,
                sidPath: track.sidPath,
                status: 'error',
                error: errorObj,
            });

            throw errorObj;
        }
    }

    private determinePipeline(session: PlaybackSessionDescriptor): 'worklet' | 'legacy' | 'hls' {
        if (this.useWorkletPlayer && this.workletPlayer) {
            return 'worklet';
        }
        if (session.fallbackHlsUrl && typeof window !== 'undefined' && HlsPlayer.isSupported()) {
            return 'hls';
        }
        return 'legacy';
    }

    private ensureHlsPlayer(): HlsPlayer {
        if (this.hlsPlayer) {
            return this.hlsPlayer;
        }
        const player = new HlsPlayer();
        player.on('statechange', (state) => {
            this.updateState(state as SidflowPlayerState);
        });
        player.on('loadprogress', (progress) => {
            this.emit('loadprogress', progress);
        });
        player.on('error', (error) => {
            this.emit('error', error);
        });
        this.hlsPlayer = player;
        return player;
    }

    async play(): Promise<void> {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            return this.workletPlayer.play();
        }
        if (this.activePipeline === 'hls' && this.hlsPlayer) {
            return this.hlsPlayer.play();
        }

        if (!this.audioBuffer) {
            return;
        }

        await this.audioContext.resume().catch((error) => {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        });

        const previousSource = this.pendingCrossfade ? this.bufferSource : null;
        const shouldCrossfade = Boolean(previousSource && this.crossfadeDurationSeconds > 0);

        if (!shouldCrossfade) {
            this.stopLegacyPlayback();
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = this.audioBuffer;

        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = shouldCrossfade ? 0 : 1;
        source.connect(gainNode);
        gainNode.connect(this.gainNode);

        const legacyNode: LegacyPlaybackNode = { source, gainNode };
        source.onended = () => {
            this.handleLegacySourceEnded(legacyNode);
        };

        const offset = clamp(this.pauseOffset, 0, this.audioBuffer.duration);
        source.start(0, offset);
        this.bufferSource = legacyNode;
        // Update startTime and pauseOffset atomically before changing state to avoid
        // race condition where UI reads inconsistent position during resume
        this.startTime = this.audioContext.currentTime - offset;
        this.pauseOffset = 0;
        this.updateState('playing');

        if (shouldCrossfade && previousSource) {
            this.startLegacyCrossfade(previousSource, legacyNode);
        }

        this.pendingCrossfade = false;
    }

    pause(): void {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            this.workletPlayer.pause();
            return;
        }
        if (this.activePipeline === 'hls' && this.hlsPlayer) {
            this.hlsPlayer.pause();
            return;
        }

        if (!this.audioBuffer || !this.bufferSource || this.state !== 'playing') {
            return;
        }
        const elapsed = this.audioContext.currentTime - this.startTime;
        this.pauseOffset = clamp(elapsed, 0, this.audioBuffer.duration);
        this.stopLegacyPlayback();
        this.updateState('paused');
    }

    stop(): void {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            this.workletPlayer.stop();
            return;
        }

        if (this.activePipeline === 'hls' && this.hlsPlayer) {
            this.hlsPlayer.stop();
            this.pauseOffset = 0;
            this.updateState('idle');
            return;
        }

        this.pauseOffset = 0;
        this.stopLegacyPlayback();
        this.updateState('idle');
    }

    seek(seconds: number): void {
        if (this.activePipeline === 'worklet') {
            console.warn('[SidflowPlayer] Seek not supported in worklet mode');
            return;
        }

        if (this.activePipeline === 'hls') {
            console.warn('[SidflowPlayer] Seek not supported in HLS fallback mode');
            return;
        }

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

    /**
     * Set the playback volume (0.0 to 1.0)
     * @param volume - Volume level from 0.0 (silent) to 1.0 (full)
     */
    setVolume(volume: number): void {
        const clamped = clamp(volume, 0, 1);
        this.gainNode.gain.value = clamped;

        // Also set volume on worklet and HLS players if active
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            this.workletPlayer.setVolume(clamped);
        }
        if (this.activePipeline === 'hls' && this.hlsPlayer) {
            this.hlsPlayer.setVolume(clamped);
        }
    }

    /**
     * Get the current playback volume (0.0 to 1.0)
     * @returns Current volume level
     */
    getVolume(): number {
        return this.gainNode.gain.value;
    }

    setCrossfadeDuration(seconds: number): void {
        const normalized = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
        this.crossfadeDurationSeconds = normalized;
        if (normalized === 0) {
            this.pendingCrossfade = false;
        }
    }

    getCrossfadeDuration(): number {
        return this.crossfadeDurationSeconds;
    }

    destroy(): void {
        if (this.activePipeline === 'worklet' && this.workletPlayer) {
            this.workletPlayer.destroy();
            this.workletPlayer = null;
            return;
        }

        if (this.hlsPlayer) {
            this.hlsPlayer.destroy();
            this.hlsPlayer = null;
        }

        this.stopLegacyPlayback();
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

    private stopLegacyPlayback(): void {
        if (this.bufferSource) {
            this.cleanupLegacyNode(this.bufferSource, true);
            this.bufferSource = null;
        }
        if (this.fadingSources.size > 0) {
            for (const node of this.fadingSources) {
                this.cleanupLegacyNode(node, true);
            }
            this.fadingSources.clear();
        }
        this.pendingCrossfade = false;
    }

    private handleLegacySourceEnded(node: LegacyPlaybackNode): void {
        if (this.bufferSource === node) {
            this.cleanupLegacyNode(node, false);
            this.bufferSource = null;
            this.pauseOffset = 0;
            this.updateState('ended');
            return;
        }

        if (this.fadingSources.has(node)) {
            this.fadingSources.delete(node);
            this.cleanupLegacyNode(node, false);
        }
    }

    private startLegacyCrossfade(outgoing: LegacyPlaybackNode, incoming: LegacyPlaybackNode): void {
        this.fadingSources.add(outgoing);
        const now = this.audioContext.currentTime;
        const duration = this.crossfadeDurationSeconds;

        outgoing.gainNode.gain.cancelScheduledValues(now);
        outgoing.gainNode.gain.setValueAtTime(outgoing.gainNode.gain.value, now);
        outgoing.gainNode.gain.linearRampToValueAtTime(0, now + duration);

        incoming.gainNode.gain.cancelScheduledValues(now);
        incoming.gainNode.gain.setValueAtTime(0, now);
        incoming.gainNode.gain.linearRampToValueAtTime(1, now + duration);

        try {
            outgoing.source.stop(now + duration + CROSSFADE_STOP_EPSILON);
        } catch {
            // Ignore stop errors
        }
    }

    private cleanupLegacyNode(node: LegacyPlaybackNode | null, stopSource: boolean): void {
        if (!node) {
            return;
        }
        try {
            node.source.onended = null;
        } catch {
            // Ignore
        }
        if (stopSource) {
            try {
                node.source.stop();
            } catch {
                // Ignore
            }
        }
        try {
            node.source.disconnect();
        } catch {
            // Ignore
        }
        try {
            node.gainNode.disconnect();
        } catch {
            // Ignore
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

        if (next === 'playing' && this.currentTrack) {
            recordImplicitAction({
                track: this.currentTrack,
                action: 'play',
                sessionId: this.currentSession?.sessionId,
                pipeline: this.activePipeline,
                metadata: {
                    stateTransition: `${oldState}->${next}`,
                    resumed: oldState === 'paused',
                },
            });
        }
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
