/**
 * AudioWorklet-based SID player with SharedArrayBuffer ring buffer.
 * 
 * Architecture:
 * - Web Worker produces audio using libsidplayfp WASM
 * - AudioWorklet pulls audio from SharedArrayBuffer ring buffer
 * - No main-thread audio processing or blocking
 * - Real-time streaming with pre-roll for glitch-free playback
 */

import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { createSABRingBuffer, type SABRingBufferPointers } from './shared/sab-ring-buffer';
import type { WorkerMessage, WorkerResponse } from './worker/sid-producer.worker';
import { telemetry } from '@/lib/telemetry';
import { fetchRomAssets, type RomAssetMap } from './fetch-rom-assets';

export type WorkletPlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

type WorkletPlayerEvent = 'statechange' | 'loadprogress' | 'error';

type EventPayloadMap = {
  statechange: WorkletPlayerState;
  loadprogress: number;
  error: Error;
};

interface LoadOptions {
  session: PlaybackSessionDescriptor;
  track: RateTrackInfo;
  signal?: AbortSignal;
}

export interface TelemetryData {
  underruns: number;
  framesConsumed: number;
  framesProduced: number;
  backpressureStalls: number;
  minOccupancy: number;
  maxOccupancy: number;
  zeroByteFrames: number;
  missedQuanta: number;
  avgDriftMs: number;
  maxDriftMs: number;
  contextSuspendCount: number;
  contextResumeCount: number;
  renderMaxDurationMs: number;
  renderAvgDurationMs: number;
  ringBufferCapacityFrames: number;
}

/**
 * AudioWorklet-based player for SID music.
 * Replaces the old AudioBufferSource approach with a real-time streaming pipeline.
 */
export class WorkletPlayer {
  private readonly audioContext: AudioContext;
  private readonly gainNode: GainNode;

  private worker: Worker | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sabPointers: SABRingBufferPointers | null = null;

  private state: WorkletPlayerState = 'idle';
  private readonly listeners: Map<WorkletPlayerEvent, Set<(payload: EventPayloadMap[WorkletPlayerEvent]) => void>> =
    new Map();

  private currentSession: PlaybackSessionDescriptor | null = null;
  private currentTrack: RateTrackInfo | null = null;
  private durationSeconds = 0;
  private startTime = 0;

  // Audio capture support
  private captureDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private capturedChunks: Blob[] = [];
  private captureEnabled = false;

  // Telemetry
  private telemetry: TelemetryData = {
    underruns: 0,
    framesConsumed: 0,
    framesProduced: 0,
    backpressureStalls: 0,
    minOccupancy: Number.MAX_SAFE_INTEGER,
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

  private readonly RING_BUFFER_CAPACITY_FRAMES = 262144; // ~5.9s at 44.1kHz
  private readonly CHANNEL_COUNT = 2; // Stereo

  private workerLoadedResolve: (() => void) | null = null;
  private workerLoadedReject: ((error: Error) => void) | null = null;
  private workerLoadedTimeout: ReturnType<typeof setTimeout> | null = null;
  private workerLoadedAbortSignal: AbortSignal | null = null;
  private workerLoadedAbortHandler: (() => void) | null = null;

  private workerReadyResolve: (() => void) | null = null;
  private workerReadyReject: ((error: Error) => void) | null = null;
  private workerReadyTimeout: ReturnType<typeof setTimeout> | null = null;

  private workletConnected = false;

  constructor(context?: AudioContext) {
    this.audioContext = context ?? new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);

    this.listeners.set('statechange', new Set());
    this.listeners.set('loadprogress', new Set());
    this.listeners.set('error', new Set());

    // Track audio context state changes
    this.audioContext.addEventListener('statechange', () => {
      if (this.audioContext.state === 'suspended') {
        this.telemetry.contextSuspendCount++;
      } else if (this.audioContext.state === 'running') {
        this.telemetry.contextResumeCount++;
      }
    });
  }

  on<Event extends WorkletPlayerEvent>(event: Event, listener: (payload: EventPayloadMap[Event]) => void): void {
    this.listeners.get(event)?.add(listener as never);
  }

  off<Event extends WorkletPlayerEvent>(event: Event, listener: (payload: EventPayloadMap[Event]) => void): void {
    this.listeners.get(event)?.delete(listener as never);
  }

  getState(): WorkletPlayerState {
    return this.state;
  }

  getSession(): PlaybackSessionDescriptor | null {
    return this.currentSession;
  }

  getTrack(): RateTrackInfo | null {
    return this.currentTrack;
  }

  getDurationSeconds(): number {
    return this.durationSeconds;
  }

  getPositionSeconds(): number {
    if (this.state !== 'playing') {
      return 0;
    }
    const elapsed = this.audioContext.currentTime - this.startTime;
    return Math.min(elapsed, this.durationSeconds);
  }

  getTelemetry(): TelemetryData {
    return { ...this.telemetry };
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    this.gainNode.gain.value = clamped;
  }

  private clearWorkerLoadedWait(): void {
    if (this.workerLoadedTimeout) {
      clearTimeout(this.workerLoadedTimeout);
      this.workerLoadedTimeout = null;
    }
    if (this.workerLoadedAbortSignal && this.workerLoadedAbortHandler) {
      this.workerLoadedAbortSignal.removeEventListener('abort', this.workerLoadedAbortHandler);
    }
    this.workerLoadedAbortSignal = null;
    this.workerLoadedAbortHandler = null;
    this.workerLoadedResolve = null;
    this.workerLoadedReject = null;
  }

  private waitForWorkerLoaded(signal?: AbortSignal): Promise<void> {
    this.clearWorkerLoadedWait();

    return new Promise<void>((resolve, reject) => {
      this.workerLoadedResolve = () => {
        this.clearWorkerLoadedWait();
        resolve();
      };

      this.workerLoadedReject = (error: Error) => {
        this.clearWorkerLoadedWait();
        reject(error);
      };

      this.workerLoadedTimeout = setTimeout(() => {
        this.workerLoadedReject?.(new Error('Worker load timeout'));
      }, 10000);

      if (signal) {
        if (signal.aborted) {
          this.workerLoadedReject?.(new DOMException('Playback load aborted', 'AbortError'));
          return;
        }

        const abortHandler = () => {
          this.workerLoadedReject?.(new DOMException('Playback load aborted', 'AbortError'));
        };

        this.workerLoadedAbortSignal = signal;
        this.workerLoadedAbortHandler = abortHandler;
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });
  }

  private clearWorkerReadyWait(): void {
    if (this.workerReadyTimeout) {
      clearTimeout(this.workerReadyTimeout);
      this.workerReadyTimeout = null;
    }
    this.workerReadyResolve = null;
    this.workerReadyReject = null;
  }

  private waitForWorkerReady(): Promise<void> {
    this.clearWorkerReadyWait();

    return new Promise<void>((resolve, reject) => {
      this.workerReadyResolve = () => {
        this.clearWorkerReadyWait();
        resolve();
      };

      this.workerReadyReject = (error: Error) => {
        this.clearWorkerReadyWait();
        reject(error);
      };

      this.workerReadyTimeout = setTimeout(() => {
        this.workerReadyReject?.(new Error('Worker ready timeout'));
      }, 10000);
    });
  }

  private rejectWorkerWaits(error: Error): void {
    this.workerLoadedReject?.(error);
    this.workerReadyReject?.(error);
  }

  private sendWorkletControl(message: { type: 'start' } | { type: 'stop' }): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage(message);
    }
  }

  /**
   * Enable audio capture for testing/analysis.
   * Must be called before play().
   */
  enableCapture(): void {
    this.captureEnabled = true;
    this.capturedChunks = [];
  }

  /**
   * Get captured audio data as a Blob.
   * Returns null if capture was not enabled or no data captured.
   */
  getCapturedAudio(): Blob | null {
    if (this.capturedChunks.length === 0) {
      return null;
    }
    return new Blob(this.capturedChunks, { type: 'audio/webm;codecs=opus' });
  }

  /**
   * Get captured audio as PCM Float32Array.
   * This decodes the captured audio back to PCM for analysis.
   */
  async getCapturedPCM(): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
    const blob = this.getCapturedAudio();
    if (!blob) {
      return null;
    }

    // Decode the captured audio
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    return {
      left: audioBuffer.getChannelData(0),
      right: audioBuffer.getChannelData(1),
      sampleRate: audioBuffer.sampleRate,
    };
  }

  async load(options: LoadOptions): Promise<void> {
    const { session, track, signal } = options;

    // Clean up any existing playback
    this.cleanup();

    this.currentSession = session;
    this.currentTrack = track;
    this.durationSeconds = session.durationSeconds || track.durationSeconds || 180;
    this.updateState('loading');

    const loadStartTime = performance.now();
    telemetry.trackPlaybackLoad({
      sessionId: session.sessionId,
      sidPath: track.sidPath,
      status: 'start',
    });

    try {
      // Check cross-origin isolation
      if (!window.crossOriginIsolated) {
        throw new Error(
          'crossOriginIsolated is false. SharedArrayBuffer requires COOP and COEP headers.'
        );
      }

      // Initialize AudioWorklet
      await this.initializeWorklet(signal);
      this.throwIfAborted(signal);

      // Initialize Web Worker
      await this.initializeWorker(signal);
      this.throwIfAborted(signal);

      // Fetch SID file
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

      // Load SID into worker
      await this.loadSidIntoWorker(sidBytes, session.selectedSong, this.durationSeconds, romAssets, signal);
      this.throwIfAborted(signal);

      this.updateState('ready');

      const loadEndTime = performance.now();
      telemetry.trackPlaybackLoad({
        sessionId: session.sessionId,
        sidPath: track.sidPath,
        status: 'success',
        metrics: {
          loadDurationMs: loadEndTime - loadStartTime,
          trackDurationSeconds: this.durationSeconds,
          fileSizeBytes: sidBytes.length,
        },
      });
    } catch (error) {
      if (signal?.aborted) {
        this.updateState('idle');
        return;
      }

      this.updateState('error');
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
    console.log('[WorkletPlayer] play() invoked', { state: this.state });
    if (this.state !== 'ready' && this.state !== 'paused') {
      console.warn('[WorkletPlayer] Cannot play from state:', this.state);
      return;
    }

    if (!this.worker || !this.workletNode) {
      throw new Error('Player not initialized');
    }

    const readyPromise = this.waitForWorkerReady();

    // Start worker rendering (pre-roll happens before resolving ready promise)
    this.worker.postMessage({ type: 'start' } as WorkerMessage);

    await readyPromise;
    console.log('[WorkletPlayer] Worker ready resolved, continuing playback setup');

    this.sendWorkletControl({ type: 'start' });

    if (this.captureEnabled && !this.captureDestination) {
      this.captureDestination = this.audioContext.createMediaStreamDestination();
      this.workletNode.connect(this.captureDestination);

      this.mediaRecorder = new MediaRecorder(this.captureDestination.stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.capturedChunks.push(event.data);
        }
      };
    }

    if (!this.workletConnected) {
      this.workletNode.connect(this.gainNode);
      this.workletConnected = true;
    }

    await this.audioContext.resume();

    if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
      this.mediaRecorder.start(100);
    }

    this.startTime = this.audioContext.currentTime;
    const previousState = this.state;
    this.updateState('playing');

    telemetry.trackPlaybackStateChange({
      sessionId: this.currentSession?.sessionId,
      sidPath: this.currentTrack?.sidPath,
      oldState: previousState,
      newState: 'playing',
      positionSeconds: 0,
    });
  }

  pause(): void {
    if (this.state !== 'playing') {
      return;
    }

    if (this.worker) {
      this.worker.postMessage({ type: 'stop' } as WorkerMessage);
    }

    this.sendWorkletControl({ type: 'stop' });

    // Stop capture if active
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.updateState('paused');
  }

  stop(): void {
    // Stop capture if active
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.cleanup();
    this.updateState('idle');
  }

  destroy(): void {
    // Stop capture if active
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.cleanup();
    this.updateState('idle');
    void this.audioContext.close().catch(() => undefined);
  }

  private async initializeWorklet(signal?: AbortSignal): Promise<void> {
    // Add worklet module
    const workletUrl = '/audio/worklet/sid-renderer.worklet.js';
    await this.audioContext.audioWorklet.addModule(workletUrl);
    this.throwIfAborted(signal);

    // Create ring buffer
    this.sabPointers = createSABRingBuffer({
      capacityFrames: this.RING_BUFFER_CAPACITY_FRAMES,
      channelCount: this.CHANNEL_COUNT,
      blockSize: 128,
    });

    // Create worklet node
    this.workletNode = new AudioWorkletNode(this.audioContext, 'sid-renderer', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [this.CHANNEL_COUNT],
      processorOptions: {
        sabPointers: this.sabPointers,
        channelCount: this.CHANNEL_COUNT,
      },
    });
    this.workletConnected = false;

    // Listen for telemetry from worklet
    this.workletNode.port.onmessage = (event: MessageEvent) => {
      this.handleWorkletMessage(event.data);
    };

    console.log('[WorkletPlayer] ✓ AudioWorklet initialized');
  }

  private async initializeWorker(signal?: AbortSignal): Promise<void> {
    if (!this.sabPointers) {
      throw new Error('Ring buffer not created');
    }

    // Create worker
    this.worker = new Worker('/audio/worker/sid-producer.worker.js', {
      type: 'module',
    });

    // Listen for messages from worker
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('[WorkletPlayer] Worker error:', error);
      const workerError = new Error('Worker error: ' + error.message);
      this.updateState('error');
      this.rejectWorkerWaits(workerError);
      this.emit('error', workerError);
    };

    // Initialize worker
    const initMessage: WorkerMessage = {
      type: 'init',
      sabPointers: this.sabPointers,
      targetSampleRate: this.audioContext.sampleRate,
    };

    this.worker.postMessage(initMessage);

    // Wait a bit for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.throwIfAborted(signal);

    console.log('[WorkletPlayer] ✓ Web Worker initialized');
  }

  private async loadSidIntoWorker(
    sidBytes: Uint8Array,
    selectedSong: number | undefined,
    durationSeconds: number,
    romAssets: RomAssetMap,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const waitForLoaded = this.waitForWorkerLoaded(signal);

    const loadMessage: WorkerMessage = {
      type: 'load',
      sidBytes,
      selectedSong,
      durationSeconds,
      roms: {
        kernal: romAssets.kernal ?? null,
        basic: romAssets.basic ?? null,
        chargen: romAssets.chargen ?? null,
      },
    };

    const transferables: Transferable[] = [sidBytes.buffer];
    if (romAssets.kernal) {
      transferables.push(romAssets.kernal.buffer);
    }
    if (romAssets.basic) {
      transferables.push(romAssets.basic.buffer);
    }
    if (romAssets.chargen) {
      transferables.push(romAssets.chargen.buffer);
    }

    this.worker!.postMessage(loadMessage, transferables);

    await waitForLoaded;
    console.log('[WorkletPlayer] Worker load resolved');
  }

  private handleWorkletMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
      return;
    }

    const message = data as { type: string };

    if (message.type === 'telemetry') {
      const tel = message as {
        type: 'telemetry';
        underruns: number;
        framesConsumed: number;
        minOccupancy: number;
        maxOccupancy: number;
        currentOccupancy: number;
        zeroByteFrames: number;
        missedQuanta: number;
        totalDriftMs: number;
        maxDriftMs: number;
      };

      this.telemetry.underruns = tel.underruns;
      this.telemetry.framesConsumed = tel.framesConsumed;
      this.telemetry.minOccupancy = Math.min(this.telemetry.minOccupancy, tel.minOccupancy);
      this.telemetry.maxOccupancy = Math.max(this.telemetry.maxOccupancy, tel.maxOccupancy);
      this.telemetry.zeroByteFrames = tel.zeroByteFrames;
      this.telemetry.missedQuanta = tel.missedQuanta;
      this.telemetry.avgDriftMs = tel.totalDriftMs;
      this.telemetry.maxDriftMs = tel.maxDriftMs;

      // Log underruns
      if (tel.underruns > 0) {
        console.warn('[WorkletPlayer] Audio underruns detected:', tel.underruns);
      }
    }
  }

  private handleWorkerMessage(data: WorkerResponse): void {
    switch (data.type) {
      case 'ready':
        console.log('[WorkletPlayer] Worker pre-roll complete, ready to play');
        this.workerReadyResolve?.();
        this.emit('loadprogress', 1);
        break;

      case 'loaded':
        console.log('[WorkletPlayer] Worker loaded SID payload');
        this.workerLoadedResolve?.();
        break;

      case 'telemetry':
        this.telemetry.framesProduced = data.framesProduced;
        this.telemetry.backpressureStalls = data.backpressureStalls;
        this.telemetry.minOccupancy = Math.min(this.telemetry.minOccupancy, data.minOccupancy);
        this.telemetry.maxOccupancy = Math.max(this.telemetry.maxOccupancy, data.maxOccupancy);
        this.telemetry.renderMaxDurationMs = Math.max(this.telemetry.renderMaxDurationMs, data.renderMaxDurationMs ?? 0);
        if (data.renderAvgDurationMs !== undefined) {
          this.telemetry.renderAvgDurationMs = data.renderAvgDurationMs;
        }
        if (data.capacityFrames !== undefined) {
          this.telemetry.ringBufferCapacityFrames = data.capacityFrames;
        }
        break;

      case 'ended':
        console.log('[WorkletPlayer] Worker finished rendering');
        this.handleWorkerEnded();
        if (this.state === 'playing') {
          this.updateState('ended');
        } else {
          console.log('[WorkletPlayer] Ignoring worker "ended" event while state =', this.state);
        }
        break;

      case 'error':
        console.error('[WorkletPlayer] Worker error:', data.error);
        {
          const error = new Error(data.error);
          this.updateState('error');
          this.rejectWorkerWaits(error);
          this.emit('error', error);
        }
        break;
    }
  }

  private handleWorkerEnded(): void {
    this.sendWorkletControl({ type: 'stop' });

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    if (this.captureDestination) {
      try {
        this.captureDestination.disconnect();
      } catch {
        // Ignore disconnect errors during teardown
      }
      this.captureDestination = null;
    }

    if (this.workletNode && this.workletConnected) {
      try {
        this.workletNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.workletConnected = false;
    }
  }

  private cleanup(): void {
    this.rejectWorkerWaits(new DOMException('Playback stopped', 'AbortError'));

    // Stop worker
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' } as WorkerMessage);
      this.worker.terminate();
      this.worker = null;
    }

    // Disconnect worklet
    if (this.workletNode) {
      this.sendWorkletControl({ type: 'stop' });
      try {
        this.workletNode.disconnect();
      } catch {
        // Ignore
      }
      this.workletNode = null;
    }

    this.workletConnected = false;

    // Clean up capture resources
    if (this.captureDestination) {
      try {
        this.captureDestination.disconnect();
      } catch {
        // Ignore
      }
      this.captureDestination = null;
    }

    if (this.mediaRecorder) {
      this.mediaRecorder = null;
    }

    this.sabPointers = null;
    this.currentSession = null;
    this.currentTrack = null;
    this.durationSeconds = 0;

    // Reset telemetry
    this.telemetry = {
      underruns: 0,
      framesConsumed: 0,
      framesProduced: 0,
      backpressureStalls: 0,
      minOccupancy: Number.MAX_SAFE_INTEGER,
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

  private updateState(next: WorkletPlayerState): void {
    if (this.state === next) {
      return;
    }

    const oldState = this.state;
    this.state = next;
    this.emit('statechange', next);

    telemetry.trackPlaybackStateChange({
      sessionId: this.currentSession?.sessionId,
      sidPath: this.currentTrack?.sidPath,
      oldState: oldState as string,
      newState: next,
      positionSeconds: this.getPositionSeconds(),
    });
  }

  private emit<Event extends WorkletPlayerEvent>(event: Event, payload: EventPayloadMap[Event]): void {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      try {
        (listener as (data: EventPayloadMap[Event]) => void)(payload);
      } catch (error) {
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

export default WorkletPlayer;
