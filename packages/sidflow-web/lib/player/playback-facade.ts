import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import type { TelemetryData } from '@/lib/audio/worklet-player';

export type PlaybackAdapterKind =
  | 'wasm'
  | 'cli'
  | 'streaming-wav'
  | 'streaming-mp3'
  | 'ultimate64';

export type PlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlaybackRuntimeContext {
  readonly target: 'browser' | 'node';
  readonly crossOriginIsolated: boolean;
  readonly hasSharedArrayBuffer: boolean;
  readonly networkOnline: boolean;
  readonly preferredChip?: '6581' | '8580r5';
  readonly preferredRenderer?: PlaybackAdapterKind;
  readonly allowsHardware?: boolean;
}

export interface PlaybackLoadRequest {
  readonly session: PlaybackSessionDescriptor;
  readonly track: RateTrackInfo;
  readonly signal?: AbortSignal;
}

export interface PlaybackTelemetrySnapshot extends TelemetryData {
  readonly adapterId: string;
  readonly adapterKind: PlaybackAdapterKind;
  readonly lastUpdated: number;
}

export interface PlaybackAvailability {
  readonly available: boolean;
  readonly reasons?: string[];
  readonly suggestedFallback?: PlaybackAdapterKind;
}

export interface PlaybackAdapterController {
  readonly id: string;
  readonly kind: PlaybackAdapterKind;
  getState(): PlaybackState;
  load(request: PlaybackLoadRequest): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  teardown(): Promise<void>;
  getTelemetry(): PlaybackTelemetrySnapshot;
}

export interface PlaybackAdapter {
  readonly id: string;
  readonly kind: PlaybackAdapterKind;
  readonly label: string;
  readonly description: string;
  readonly priority: number;
  checkAvailability(context: PlaybackRuntimeContext): Promise<PlaybackAvailability>;
  createController(context: PlaybackRuntimeContext): Promise<PlaybackAdapterController>;
}

export interface PlaybackAdapterSummary {
  readonly id: string;
  readonly kind: PlaybackAdapterKind;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly reasons?: string[];
}

export interface PlaybackSelection {
  readonly adapterId: string;
  readonly kind: PlaybackAdapterKind;
  readonly context: PlaybackRuntimeContext;
}

export class AdapterUnavailableError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly reasons: readonly string[] | undefined
  ) {
    super(
      reasons?.length
        ? `Adapter "${adapterId}" unavailable: ${reasons.join('; ')}`
        : `Adapter "${adapterId}" unavailable`
    );
    this.name = 'AdapterUnavailableError';
  }
}

export class PlaybackFacade {
  private readonly adapters = new Map<string, PlaybackAdapter>();
  private preferredAdapterId: string | null = null;
  private activeController: PlaybackAdapterController | null = null;
  private activeContextKey: string | null = null;

  registerAdapter(
    adapter: PlaybackAdapter,
    options: { preferred?: boolean } = {}
  ): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter with id "${adapter.id}" already registered`);
    }
    this.adapters.set(adapter.id, adapter);
    if (options.preferred || this.preferredAdapterId === null) {
      this.preferredAdapterId = adapter.id;
    }
  }

  listAdapters(context: PlaybackRuntimeContext): Promise<PlaybackAdapterSummary[]> {
    return Promise.all(
      [...this.adapters.values()]
        .sort((a, b) => b.priority - a.priority)
        .map(async (adapter) => {
          const availability = await adapter.checkAvailability(context);
          return {
            id: adapter.id,
            kind: adapter.kind,
            label: adapter.label,
            description: adapter.description,
            available: availability.available,
            reasons: availability.reasons,
          };
        })
    );
  }

  setPreferredAdapter(adapterId: string): void {
    if (!this.adapters.has(adapterId)) {
      throw new Error(`Adapter "${adapterId}" is not registered`);
    }
    this.preferredAdapterId = adapterId;
    if (this.activeController && this.activeController.id !== adapterId) {
      void this.activeController.teardown().catch(() => undefined);
      this.activeController = null;
      this.activeContextKey = null;
    }
  }

  async ensureAdapter(
    context: PlaybackRuntimeContext
  ): Promise<PlaybackAdapterController> {
    const contextKey = this.getContextKey(context);
    if (this.activeController && this.activeContextKey === contextKey) {
      return this.activeController;
    }

    if (this.activeController) {
      await this.activeController.teardown().catch(() => undefined);
      this.activeController = null;
      this.activeContextKey = null;
    }

    const ordered = [...this.adapters.values()].sort(
      (a, b) => b.priority - a.priority
    );

    const preferredId = this.preferredAdapterId;
    const candidates = preferredId
      ? [
          ...ordered.filter((adapter) => adapter.id === preferredId),
          ...ordered.filter((adapter) => adapter.id !== preferredId),
        ]
      : ordered;

    const errors: AdapterUnavailableError[] = [];
    for (const adapter of candidates) {
      const availability = await adapter.checkAvailability(context);
      if (!availability.available) {
        errors.push(new AdapterUnavailableError(adapter.id, availability.reasons));
        continue;
      }
      const controller = await adapter.createController(context);
      this.activeController = controller;
      this.activeContextKey = contextKey;
      this.preferredAdapterId = adapter.id;
      return controller;
    }

    const uniqueReasons = [
      ...new Set(
        errors
          .flatMap((error) => error.reasons ?? [`Adapter ${error.adapterId} unavailable`])
          .filter(Boolean)
      ),
    ];
    throw new AdapterUnavailableError(
      preferredId ?? 'unknown',
      uniqueReasons.length ? uniqueReasons : undefined
    );
  }

  async load(
    request: PlaybackLoadRequest,
    context: PlaybackRuntimeContext
  ): Promise<PlaybackSelection> {
    const controller = await this.ensureAdapter(context);
    await controller.load(request);
    return {
      adapterId: controller.id,
      kind: controller.kind,
      context,
    };
  }

  async teardown(): Promise<void> {
    if (!this.activeController) {
      return;
    }
    await this.activeController.teardown().catch(() => undefined);
    this.activeController = null;
    this.activeContextKey = null;
  }

  getActiveAdapterId(): string | null {
    return this.activeController?.id ?? null;
  }

  private getContextKey(context: PlaybackRuntimeContext): string {
    return JSON.stringify([
      context.target,
      context.crossOriginIsolated,
      context.hasSharedArrayBuffer,
      context.networkOnline,
      context.preferredChip ?? '',
      context.preferredRenderer ?? '',
      context.allowsHardware ?? '',
    ]);
  }
}
