/**
 * Telemetry utility for tracking playback events and performance metrics.
 * Designed for future multi-user scale: logs to console in dev, can be extended
 * to send to analytics/monitoring service in production.
 */

export interface PlaybackTelemetryEvent {
    type: 'playback.load.start' | 'playback.load.success' | 'playback.load.error' |
    'playback.state.change' | 'playback.error' | 'playback.performance';
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

class TelemetryService {
    private enabled: boolean;

    constructor() {
        // Enable in all environments for now; can be gated by env var later
        this.enabled = true;
    }

    track(event: PlaybackTelemetryEvent): void {
        if (!this.enabled) {
            return;
        }

        // In development, log to console
        if (process.env.NODE_ENV === 'development') {
            console.log('[Telemetry]', event.type, event);
        }

        // Future: Send to analytics service for production
        // Example: fetch('/api/telemetry', { method: 'POST', body: JSON.stringify(event) })
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
        this.track({
            type: 'playback.performance',
            timestamp: Date.now(),
            sessionId: params.sessionId,
            sidPath: params.sidPath,
            metadata: params.metrics as Record<string, unknown>,
        });
    }
}

// Singleton instance
export const telemetry = new TelemetryService();
