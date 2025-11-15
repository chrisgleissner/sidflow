declare module 'hls.js' {
    export interface ErrorData {
        type: string;
        details?: string;
        fatal: boolean;
    }

    export interface HlsConfig {
        enableWorker?: boolean;
        lowLatencyMode?: boolean;
        [key: string]: unknown;
    }

    export default class Hls {
        constructor(config?: HlsConfig);
        static isSupported(): boolean;
        attachMedia(media: HTMLMediaElement): void;
        loadSource(url: string): void;
        startLoad(startPosition?: number): void;
        recoverMediaError(): void;
        destroy(): void;
        on(event: string, handler: (...args: unknown[]) => void): void;
        off(event: string, handler: (...args: unknown[]) => void): void;
    }

    export const Events: Record<string, string>;
    export const ErrorTypes: Record<string, string>;
}
