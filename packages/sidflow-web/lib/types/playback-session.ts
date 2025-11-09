export type PlaybackSessionScope = 'rate' | 'play' | 'manual';

export interface PlaybackSessionDescriptor {
    sessionId: string;
    sidUrl: string;
    scope: PlaybackSessionScope;
    durationSeconds: number;
    selectedSong: number;
    expiresAt: string;
}
