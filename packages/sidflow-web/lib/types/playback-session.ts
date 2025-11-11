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
}
