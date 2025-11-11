/**
 * Telemetry utility for tracking playback events and performance metrics.
 * 
 * Supports three modes:
 * - production: Sends data to analytics service via sendBeacon
 * - test: Redirects to in-memory sink (window.telemetrySink)
 * - disabled: No recording
 * 
 * Mode is controlled by NEXT_PUBLIC_TELEMETRY_MODE environment variable.
 */

export type TelemetryMode = 'production' | 'test' | 'disabled';

export interface PlaybackTelemetryEvent {
    type: 'playback.load.start' | 'playback.load.success' | 'playback.load.error' |
    'playback.state.change' | 'playback.error' | 'playback.performance' | 'playback.audio.metrics';
    timestamp: number;
    sessionId?: string;
    sidPath?: string;
    metadata?: Record<string, unknown>;
}

export interface PerformanceMetrics {
    loadDurationMs?: number;
    renderDurationMs?: number;
    trackDurationSeconds?: number;
    fileSizeBytes?: number;
}

export interface AudioMetrics {
    underruns: number;
    zeroByteFrames: number;
    missedQuanta: number;
    avgDriftMs: number;
    maxDriftMs: number;
    minOccupancy: number;
    maxOccupancy: number;
    framesConsumed: number;
    framesProduced: number;
    backpressureStalls: number;
    contextSuspendCount: number;
    contextResumeCount: number;
}

// Extend window type for test sink
declare global {
    interface Window {
        telemetrySink?: PlaybackTelemetryEvent[];
        telemetry?: TelemetryService;
    }
}

class TelemetryService {
    private mode: TelemetryMode;
    private endpoint = '/api/telemetry';

    constructor() {
        // Determine mode from environment variable
        const envMode = (typeof window !== 'undefined' 
            ? (window as any).NEXT_PUBLIC_TELEMETRY_MODE 
            : process.env.NEXT_PUBLIC_TELEMETRY_MODE) || 'production';
        
        this.mode = ['production', 'test', 'disabled'].includes(envMode) 
            ? envMode as TelemetryMode 
            : 'production';

        if (typeof window !== 'undefined') {
            window.telemetry = this;
            if (this.mode === 'test' && !Array.isArray(window.telemetrySink)) {
                window.telemetrySink = [];
            }
        }
    }

    /**
     * Set telemetry mode (useful for testing)
     */
    setMode(mode: TelemetryMode): void {
        this.mode = mode;
    }

    /**
     * Get current telemetry mode
     */
    getMode(): TelemetryMode {
        return this.mode;
    }

    track(event: PlaybackTelemetryEvent): void {
        if (this.mode === 'disabled') {
            return;
        }

        if (this.mode === 'test') {
            // In test mode, push to window.telemetrySink
            if (typeof window !== 'undefined') {
                if (!Array.isArray(window.telemetrySink)) {
                    window.telemetrySink = [];
                }
                window.telemetrySink.push(event);
            }
            return;
        }

        // Production mode: log to console in dev, send to analytics in prod
        if (process.env.NODE_ENV === 'development') {
            console.log('[Telemetry]', event.type, event);
        }

        // Send to analytics service using sendBeacon (non-blocking)
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            try {
                const blob = new Blob([JSON.stringify(event)], { type: 'application/json' });
                navigator.sendBeacon(this.endpoint, blob);
            } catch (error) {
                // Silently fail - telemetry should never break the app
                if (process.env.NODE_ENV === 'development') {
                    console.warn('[Telemetry] Failed to send beacon:', error);
                }
            }
        }
    }

    trackPlaybackLoad(params: {
        sessionId?: string;
        sidPath?: string;
        status: 'start' | 'success' | 'error';
        error?: Error;
        metrics?: PerformanceMetrics;
    }): void {
        const eventType = params.status === 'start'
            ? 'playback.load.start'
            : params.status === 'success'
                ? 'playback.load.success'
                : 'playback.load.error';

        this.track({
            type: eventType,
            timestamp: Date.now(),
            sessionId: params.sessionId,
            sidPath: params.sidPath,
            metadata: {
                error: params.error ? {
                    message: params.error.message,
                    name: params.error.name,
                    stack: params.error.stack,
                } : undefined,
                metrics: params.metrics,
            },
        });
    }

    trackPlaybackStateChange(params: {
        sessionId?: string;
        sidPath?: string;
        oldState: string;
        newState: string;
        positionSeconds?: number;
    }): void {
        this.track({
            type: 'playback.state.change',
            timestamp: Date.now(),
            sessionId: params.sessionId,
            sidPath: params.sidPath,
            metadata: {
                oldState: params.oldState,
                newState: params.newState,
                positionSeconds: params.positionSeconds,
            },
        });
    }

    trackPlaybackError(params: {
        sessionId?: string;
        sidPath?: string;
        error: Error;
        context?: Record<string, unknown>;
    }): void {
        this.track({
            type: 'playback.error',
            timestamp: Date.now(),
            sessionId: params.sessionId,
            sidPath: params.sidPath,
            metadata: {
                error: {
                    message: params.error.message,
                    name: params.error.name,
                    stack: params.error.stack,
                },
                context: params.context,
            },
        });
    }

    trackPerformance(params: {
        sessionId?: string;
        sidPath?: string;
        metrics: PerformanceMetrics;
    }): void {
        const metadata: Record<string, unknown> = { ...params.metrics };
        this.track({
            type: 'playback.performance',
            timestamp: Date.now(),
            sessionId: params.sessionId,
            sidPath: params.sidPath,
            metadata,
        });
    }

    trackAudioMetrics(params: {
        sessionId?: string;
        sidPath?: string;
        metrics: AudioMetrics;
    }): void {
        const metadata: Record<string, unknown> = { ...params.metrics };
        this.track({
            type: 'playback.audio.metrics',
            timestamp: Date.now(),
            sessionId: params.sessionId,
            sidPath: params.sidPath,
            metadata,
        });
    }
}

// Singleton instance
export const telemetry = new TelemetryService();
