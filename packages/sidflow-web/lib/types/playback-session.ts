export type PlaybackSessionScope = 'rate' | 'play' | 'manual';

export interface SessionRomUrls {
    kernal?: string;
    basic?: string;
    chargen?: string;
}

export interface PlaybackSessionDescriptor {
    sessionId: string;
    sidUrl: string;
    scope: PlaybackSessionScope;
    durationSeconds: number;
    selectedSong: number;
    expiresAt: string;
    romUrls?: SessionRomUrls;
    fallbackHlsUrl?: string | null;
    streamUrls?: SessionStreamUrls;
}

export interface SessionStreamDescriptor {
    format: 'wav' | 'm4a' | 'flac';
    url: string;
    sizeBytes: number;
    durationMs: number;
    sampleRate: number;
    channels: number;
    bitrateKbps?: number;
    codec?: string;
    publicPath?: string;
}

export type SessionStreamUrls = Partial<Record<'wav' | 'm4a' | 'flac', SessionStreamDescriptor>>;
