'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  controlRatePlayback,
  getRatePlaybackStatus,
  playManualTrack,
  rateTrack,
  requestRandomPlayTrack,
  type RateTrackInfo,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import { Play, Pause, SkipForward, SkipBack, ThumbsUp, ThumbsDown, Forward, Music2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PlayTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
  onTrackPlayed: (sidPath: string) => void;
}

const PRESETS = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'dark', label: 'Dark' },
  { value: 'bright', label: 'Bright' },
  { value: 'complex', label: 'Complex' },
] as const;

type MoodPreset = (typeof PRESETS)[number]['value'];

const HISTORY_LIMIT = 3;
const UPCOMING_DISPLAY_LIMIT = 3;
const INITIAL_PLAYLIST_SIZE = 12;

interface InfoProps {
  label: string;
  value: ReactNode;
}

function InfoRow({ label, value }: InfoProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground uppercase tracking-tight">{label}</span>
      <span className="font-semibold text-foreground text-right break-words">{value}</span>
    </div>
  );
}

interface PlaylistTrack extends RateTrackInfo {
  playlistNumber: number;
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.floor(seconds % 60));
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseLengthSeconds(length?: string): number {
  if (!length) {
    return 180;
  }

  if (length.includes(':')) {
    const [minutes, secondsPart] = length.split(':');
    const mins = Number(minutes);
    const secs = Number(secondsPart);
    if (!Number.isNaN(mins) && !Number.isNaN(secs)) {
      return Math.max(15, mins * 60 + secs);
    }
  }

  const numeric = Number(length);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return Math.max(15, numeric);
  }

  return 180;
}

export function PlayTab({ onStatusChange, onTrackPlayed }: PlayTabProps) {
  const [preset, setPreset] = useState<MoodPreset>('energetic');
  const [currentTrack, setCurrentTrack] = useState<PlaylistTrack | null>(null);
  const [duration, setDuration] = useState(180);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRating, setIsRating] = useState(false);
  const [playedTracks, setPlayedTracks] = useState<PlaylistTrack[]>([]);
  const [upcomingTracks, setUpcomingTracks] = useState<PlaylistTrack[]>([]);

  const seekTimeout = useRef<NodeJS.Timeout | null>(null);
  const playlistCounterRef = useRef(1);
  const trackNumberMapRef = useRef<Map<string, number>>(new Map());
  const playedRef = useRef<PlaylistTrack[]>([]);
  const upcomingRef = useRef<PlaylistTrack[]>([]);
  const currentTrackRef = useRef<PlaylistTrack | null>(null);

  useEffect(() => {
    playedRef.current = playedTracks;
  }, [playedTracks]);

  useEffect(() => {
    upcomingRef.current = upcomingTracks;
  }, [upcomingTracks]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    return () => {
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
    };
  }, []);

  const statusHandlerRef = useRef(onStatusChange);
  const trackPlayedHandlerRef = useRef(onTrackPlayed);

  useEffect(() => {
    statusHandlerRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    trackPlayedHandlerRef.current = onTrackPlayed;
  }, [onTrackPlayed]);

  const notifyStatus = useCallback((message: string, isError = false) => {
    statusHandlerRef.current(message, isError);
  }, []);

  const notifyTrackPlayed = useCallback((sidPath: string) => {
    trackPlayedHandlerRef.current(sidPath);
  }, []);

  const assignPlaylistNumber = useCallback((track: RateTrackInfo): PlaylistTrack => {
    const existing = trackNumberMapRef.current.get(track.sidPath);
    if (existing) {
      return { ...track, playlistNumber: existing };
    }
    const playlistNumber = playlistCounterRef.current++;
    trackNumberMapRef.current.set(track.sidPath, playlistNumber);
    return { ...track, playlistNumber };
  }, []);

  const rebuildPlaylist = useCallback(async () => {
    setIsLoading(true);
    try {
      await controlRatePlayback({ action: 'stop' }).catch(() => undefined);
      trackNumberMapRef.current.clear();
      playlistCounterRef.current = 1;
      playedRef.current = [];
      upcomingRef.current = [];
      setPlayedTracks([]);
      setUpcomingTracks([]);
      currentTrackRef.current = null;
      setCurrentTrack(null);
      setIsPlaying(false);
      setPosition(0);
      setDuration(180);

      const seeded: PlaylistTrack[] = [];
      for (let index = 0; index < INITIAL_PLAYLIST_SIZE; index += 1) {
        const response = await requestRandomPlayTrack(preset, { preview: true });
        if (!response.success) {
          notifyStatus(`Unable to seed playlist: ${formatApiError(response)}`, true);
          break;
        }
        const numbered = assignPlaylistNumber(response.data.track);
        seeded.push(numbered);
      }
      if (seeded.length === 0) {
        notifyStatus('No songs available for this preset.', true);
      }
      upcomingRef.current = seeded;
        setUpcomingTracks(seeded.slice(0, UPCOMING_DISPLAY_LIMIT));
    } catch (error) {
      notifyStatus(
        `Unable to seed playlist: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      setIsLoading(false);
    }
  }, [assignPlaylistNumber, notifyStatus, preset]);

  useEffect(() => {
    void rebuildPlaylist();
  }, [rebuildPlaylist]);

  const startPlayback = useCallback(
    async (track: PlaylistTrack, announcement?: string) => {
      setIsLoading(true);
      try {
        const response = await playManualTrack({ sid_path: track.sidPath });
        if (!response.success) {
          notifyStatus(`Unable to load SID: ${formatApiError(response)}`, true);
          return false;
        }
        const normalized: PlaylistTrack = {
          ...response.data.track,
          playlistNumber: track.playlistNumber,
        };
        trackNumberMapRef.current.set(normalized.sidPath, normalized.playlistNumber);
        setCurrentTrack(normalized);
        currentTrackRef.current = normalized;
        setDuration(normalized.durationSeconds ?? parseLengthSeconds(normalized.metadata.length));
        setPosition(0);
        setIsPlaying(true);
        if (announcement) {
          notifyStatus(announcement);
        }
        notifyTrackPlayed(normalized.sidPath);
        return true;
      } catch (error) {
        notifyStatus(
          `Unable to load SID: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [notifyStatus, notifyTrackPlayed]
  );

  const playNextFromQueue = useCallback(async () => {
    if (upcomingRef.current.length === 0) {
      notifyStatus('No upcoming songs. Change the preset to rebuild the playlist.', true);
      return;
    }
    const nextTrack = upcomingRef.current.shift()!;
    setUpcomingTracks(upcomingRef.current.slice(0, UPCOMING_DISPLAY_LIMIT));
    const previousTrack = currentTrackRef.current;
    const success = await startPlayback(
      nextTrack,
      `Now playing #${nextTrack.playlistNumber}: ${nextTrack.displayName}`
    );
    if (success && previousTrack) {
      playedRef.current = [previousTrack, ...playedRef.current].slice(0, HISTORY_LIMIT);
      setPlayedTracks(playedRef.current.slice());
    }
    if (!success) {
      upcomingRef.current = [nextTrack, ...upcomingRef.current];
      setUpcomingTracks(upcomingRef.current.slice(0, UPCOMING_DISPLAY_LIMIT));
    } else {
      setUpcomingTracks(upcomingRef.current.slice(0, UPCOMING_DISPLAY_LIMIT));
    }
  }, [notifyStatus, startPlayback]);

  const refreshStatus = useCallback(async () => {
    const response = await getRatePlaybackStatus();
    if (!response.success) {
      return;
    }
    const status = response.data;
    if (!status.active) {
      setIsPlaying(false);
      return;
    }
    setIsPlaying(!status.isPaused);
    if (typeof status.positionSeconds === 'number') {
      setPosition(status.positionSeconds);
    }
    if (typeof status.durationSeconds === 'number') {
      setDuration(status.durationSeconds);
    }
    if (
      status.track &&
      currentTrackRef.current &&
      status.track.sidPath === currentTrackRef.current.sidPath
    ) {
      setCurrentTrack((prev) => (prev ? { ...prev, ...status.track, playlistNumber: prev.playlistNumber } : prev));
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshStatus, isPlaying ? 1000 : 4000);
    void refreshStatus();
    return () => clearInterval(interval);
  }, [refreshStatus, isPlaying]);

  const handlePlayPause = useCallback(async () => {
    if (!currentTrack) {
      return;
    }
    const action = isPlaying ? 'pause' : 'resume';
    const response = await controlRatePlayback({ action });
    if (response.success) {
      setIsPlaying(!isPlaying);
      notifyStatus(isPlaying ? 'Playback paused' : 'Playback resumed');
      await refreshStatus();
    } else {
      notifyStatus(`Playback control failed: ${formatApiError(response)}`, true);
    }
  }, [currentTrack, isPlaying, notifyStatus, refreshStatus]);

  const handlePreviousTrack = useCallback(async () => {
    if (playedRef.current.length === 0) {
      notifyStatus('No previously played songs', true);
      return;
    }
    const track = playedRef.current.shift()!;
    if (currentTrackRef.current) {
      upcomingRef.current = [currentTrackRef.current, ...upcomingRef.current];
      setUpcomingTracks(upcomingRef.current.slice(0, UPCOMING_DISPLAY_LIMIT));
    }
    const success = await startPlayback(
      track,
      `Replaying #${track.playlistNumber}: ${track.displayName}`
    );
    if (!success) {
      playedRef.current = [track, ...playedRef.current].slice(0, HISTORY_LIMIT);
      setPlayedTracks(playedRef.current.slice());
    } else {
      setPlayedTracks(playedRef.current.slice());
    }
  }, [notifyStatus, startPlayback]);

  const replayFromHistory = useCallback(
    async (track: PlaylistTrack) => {
      const previousTrack = currentTrackRef.current;
      playedRef.current = playedRef.current.filter((entry) => entry.sidPath !== track.sidPath);
      setPlayedTracks(playedRef.current.slice(0, HISTORY_LIMIT));

      const success = await startPlayback(
        track,
        `Replaying #${track.playlistNumber}: ${track.displayName}`
      );

      if (!success) {
        playedRef.current = [track, ...playedRef.current].slice(0, HISTORY_LIMIT);
        setPlayedTracks(playedRef.current.slice());
        return;
      }

      if (previousTrack && previousTrack.sidPath !== track.sidPath) {
        playedRef.current = [previousTrack, ...playedRef.current].slice(0, HISTORY_LIMIT);
      }
      setPlayedTracks(playedRef.current.slice());
    },
    [startPlayback]
  );

  const handleSeek = useCallback(
    (value: number[]) => {
      if (!currentTrack) {
        return;
      }
      const next = Math.min(Math.max(0, value[0]), duration);
      setPosition(next);
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
      seekTimeout.current = setTimeout(() => {
        void controlRatePlayback({ action: 'seek', positionSeconds: next });
      }, 250);
    },
    [currentTrack, duration]
  );

  const submitRating = useCallback(
    async (value: number, label: string, advance: boolean) => {
      if (!currentTrack || isRating) {
        return;
      }
      setIsRating(true);
      try {
        const response = await rateTrack({
          sid_path: currentTrack.sidPath,
          ratings: { e: value, m: value, c: value, p: value },
        });
        if (!response.success) {
          notifyStatus(`Rating failed: ${formatApiError(response)}`, true);
          return;
        }
        notifyStatus(`${label} recorded for "${currentTrack.displayName}"`);
        if (advance) {
          if (upcomingRef.current.length === 0) {
            notifyStatus('No upcoming songs remaining.', true);
          } else {
            await playNextFromQueue();
          }
        }
      } catch (error) {
        notifyStatus(
          `Failed to rate: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
      } finally {
        setIsRating(false);
      }
    },
    [currentTrack, isRating, notifyStatus, playNextFromQueue]
  );

  const highestPlaylistNumber = useMemo(() => {
    const numbers = [
      currentTrack?.playlistNumber ?? 0,
      ...playedTracks.map((track) => track.playlistNumber),
      ...upcomingTracks.map((track) => track.playlistNumber),
    ];
    return numbers.length > 0 ? Math.max(...numbers) : 0;
  }, [currentTrack, playedTracks, upcomingTracks]);

  const renderTrackList = (
    tracks: PlaylistTrack[],
    emptyLabel: string,
    variant: 'played' | 'upcoming'
  ) => {
    if (tracks.length === 0) {
      return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
    }
    return (
      <div className="space-y-2">
        {tracks.map((track) => (
          <div
            key={`${variant}-${track.playlistNumber}-${track.sidPath}`}
            className="flex items-center justify-between rounded border border-border/50 px-2 py-1 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground truncate">
                #{track.playlistNumber} • {track.displayName}
              </p>
              <p className="text-muted-foreground truncate">{track.metadata.author ?? '—'}</p>
            </div>
            {variant === 'played' ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => replayFromHistory(track)}
                title="Replay this song"
              >
                <Play className="h-3 w-3" />
              </Button>
            ) : (
              <span className="text-muted-foreground text-[10px]">Queued</span>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="c64-border">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="petscii-text text-accent">PLAY SID MUSIC</CardTitle>
              <CardDescription className="text-muted-foreground">
                Build a playlist for the selected mood and enjoy hands-free playback.
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 md:w-64">
              <Select value={preset} onValueChange={(value) => setPreset(value as MoodPreset)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={playNextFromQueue}
                disabled={isLoading || upcomingTracks.length === 0}
                className="w-full retro-glow gap-2"
              >
                <Play className="h-4 w-4" />
                {upcomingTracks.length === 0 ? 'PLAYLIST EMPTY' : 'PLAY NEXT TRACK'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePreviousTrack}
                disabled={!currentTrack || playedTracks.length === 0 || isLoading}
                title="Previous track"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePlayPause}
                disabled={!currentTrack || isLoading}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={playNextFromQueue}
                disabled={upcomingTracks.length === 0 || isLoading}
                title="Next track"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 w-full">
              <Slider
                value={[position]}
                onValueChange={handleSeek}
                min={0}
                max={Math.max(duration, 1)}
                step={1}
                disabled={!currentTrack}
                className="cursor-pointer"
              />
              <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                <span>{formatSeconds(position)}</span>
                <span>{formatSeconds(duration)}</span>
              </div>
            </div>
          </div>

          {currentTrack && (
            <div className="rounded border border-border/60 bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Music2 className="h-4 w-4" />
                <span className="break-all">
                  {currentTrack.sidPath.slice(
                    0,
                    currentTrack.sidPath.length - currentTrack.filename.length
                  )}
                  <span className="font-semibold text-foreground">{currentTrack.filename}</span>
                </span>
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  #{currentTrack.playlistNumber} • {currentTrack.displayName}
                </p>
                <p className="text-muted-foreground">
                  Song #{currentTrack.playlistNumber} of {highestPlaylistNumber || '—'}
                </p>
              </div>
              <div className="flex flex-col gap-4 text-xs md:flex-row md:items-stretch md:gap-12">
                <div className="flex-1 space-y-2">
                  <InfoRow label="Artist" value={currentTrack.metadata.author ?? '—'} />
                  <InfoRow label="Year" value={currentTrack.metadata.released ?? '—'} />
                  <InfoRow label="Song" value={`${currentTrack.selectedSong}/${currentTrack.metadata.songs}`} />
                </div>
                <div className="hidden md:block w-px bg-border/60 md:mx-6 lg:mx-10" aria-hidden="true" />
                <div className="flex-1 space-y-2">
                  <InfoRow label="Length" value={currentTrack.metadata.length ?? '—'} />
                  <InfoRow
                    label="File Size"
                    value={`${(currentTrack.metadata.fileSizeBytes / 1024).toFixed(1)} KB`}
                  />
                  <InfoRow label="SID Model" value={currentTrack.metadata.sidModel} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isRating}
                  onClick={() => submitRating(5, 'Like', true)}
                >
                  <ThumbsUp className="h-4 w-4" /> Like
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isRating}
                  onClick={() => submitRating(1, 'Dislike', true)}
                >
                  <ThumbsDown className="h-4 w-4" /> Dislike
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isRating}
                  onClick={() => submitRating(3, 'Skipped', true)}
                >
                  <Forward className="h-4 w-4" /> Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="c64-border">
          <CardHeader>
            <CardTitle className="text-sm petscii-text text-accent">Played Tracks</CardTitle>
            <CardDescription className="text-muted-foreground">
              Most recent first • click to replay
            </CardDescription>
          </CardHeader>
          <CardContent>{renderTrackList(playedTracks, 'No songs played yet.', 'played')}</CardContent>
        </Card>
        <Card className="c64-border">
          <CardHeader>
            <CardTitle className="text-sm petscii-text text-accent">Upcoming Tracks</CardTitle>
            <CardDescription className="text-muted-foreground">
              Fixed queue for this mood
            </CardDescription>
          </CardHeader>
          <CardContent>
            {renderTrackList(
              upcomingTracks.slice(0, UPCOMING_DISPLAY_LIMIT),
              'Playlist generated. Use Play Next Track to begin.',
              'upcoming'
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
