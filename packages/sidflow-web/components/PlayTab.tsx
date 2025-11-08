'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  controlRatePlayback,
  getRatePlaybackStatus,
  rateTrack,
  requestRandomPlayTrack,
  type RateTrackInfo,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import { getUpcomingSongs } from '@/lib/sid-metadata';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ThumbsUp,
  ThumbsDown,
  Shuffle,
  Forward,
  Music2,
} from 'lucide-react';
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

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.floor(seconds % 60));
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function PlayTab({ onStatusChange, onTrackPlayed }: PlayTabProps) {
  const [preset, setPreset] = useState<MoodPreset>('energetic');
  const [currentTrack, setCurrentTrack] = useState<RateTrackInfo | null>(null);
  const [duration, setDuration] = useState(180);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRating, setIsRating] = useState(false);
  const [upcomingSongs, setUpcomingSongs] = useState(getUpcomingSongs());
  const seekTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
    };
  }, []);

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
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshStatus, isPlaying ? 1000 : 4000);
    void refreshStatus();
    return () => clearInterval(interval);
  }, [refreshStatus, isPlaying]);

  const loadRandomTrack = useCallback(
    async (notify: boolean = true) => {
      setIsLoading(true);
      if (notify) {
        onStatusChange('Selecting a track and starting playback…');
      }

      try {
        const response = await requestRandomPlayTrack(preset);
        if (!response.success) {
          onStatusChange(`Playback failed: ${formatApiError(response)}`, true);
          return;
        }
        const track = response.data.track;
        setCurrentTrack(track);
        setDuration(track.durationSeconds);
        setPosition(0);
        setIsPlaying(true);
        setUpcomingSongs(getUpcomingSongs());
        onTrackPlayed(track.sidPath);
        await refreshStatus();
        onStatusChange(`Now playing "${track.displayName}"`);
      } catch (error) {
        onStatusChange(
          `Failed to start playback: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
      } finally {
        setIsLoading(false);
      }
    },
    [preset, onStatusChange, onTrackPlayed, refreshStatus]
  );

  const handleTransport = useCallback(
    async (action: 'pause' | 'resume' | 'stop') => {
      const response = await controlRatePlayback({ action });
      if (response.success) {
        await refreshStatus();
        onStatusChange(
          action === 'stop'
            ? 'Playback stopped'
            : action === 'pause'
            ? 'Playback paused'
            : 'Playback resumed'
        );
      } else {
        onStatusChange(`Playback control failed: ${formatApiError(response)}`, true);
      }
    },
    [onStatusChange, refreshStatus]
  );

  const handleSeek = useCallback(
    (value: number[]) => {
      const target = Math.max(0, Math.min(duration, value[0]));
      setPosition(target);
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
      seekTimeout.current = setTimeout(async () => {
        const response = await controlRatePlayback({ action: 'seek', positionSeconds: target });
        if (!response.success) {
          onStatusChange(`Seek failed: ${formatApiError(response)}`, true);
        } else {
          await refreshStatus();
        }
      }, 250);
    },
    [duration, onStatusChange, refreshStatus]
  );

  const handleRestart = useCallback(async () => {
    const response = await controlRatePlayback({ action: 'seek', positionSeconds: 0 });
    if (!response.success) {
      onStatusChange(`Seek failed: ${formatApiError(response)}`, true);
    } else {
      await refreshStatus();
    }
  }, [onStatusChange, refreshStatus]);

  const handleQuickSeek = useCallback(
    async (offset: number) => {
      const next = Math.max(0, Math.min(duration, position + offset));
      const response = await controlRatePlayback({ action: 'seek', positionSeconds: next });
      if (!response.success) {
        onStatusChange(`Seek failed: ${formatApiError(response)}`, true);
      } else {
        await refreshStatus();
      }
    },
    [duration, position, onStatusChange, refreshStatus]
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
          onStatusChange(`Rating failed: ${formatApiError(response)}`, true);
          return;
        }
        onStatusChange(`${label} recorded for "${currentTrack.displayName}"`);
        if (advance) {
          await loadRandomTrack(false);
        }
      } catch (error) {
        onStatusChange(
          `Failed to rate: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
      } finally {
        setIsRating(false);
      }
    },
    [currentTrack, isRating, loadRandomTrack, onStatusChange]
  );

  const previewSong = upcomingSongs[0];
  const nextSongs = upcomingSongs.slice(1, 4);

  return (
    <div className="space-y-4">
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">PLAY SID MUSIC</CardTitle>
          <CardDescription className="text-muted-foreground">
            Choose a mood and let SIDFlow keep the music going.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-tight text-muted-foreground">
              MOOD PRESET
            </label>
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
          </div>
          <Button
            onClick={() => loadRandomTrack(true)}
            disabled={isLoading}
            className="w-full retro-glow gap-2"
          >
            <Shuffle className="h-4 w-4" />
            {isLoading ? 'LOADING…' : 'PLAY RANDOM TRACK'}
          </Button>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">TRANSPORT</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Slider
                  value={[position]}
                  onValueChange={handleSeek}
                  min={0}
                  max={Math.max(duration, 1)}
                  step={1}
                  disabled={!currentTrack}
                  className="cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleRestart}
                  disabled={!currentTrack}
                  title="Restart track"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleTransport(isPlaying ? 'pause' : 'resume')}
                  disabled={!currentTrack}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleQuickSeek(10)}
                  disabled={!currentTrack}
                  title="Skip ahead 10s"
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{formatSeconds(position)}</span>
              <span>{formatSeconds(duration)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {currentTrack && (
        <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">NOW PLAYING</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
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
            <p className="text-base font-semibold text-foreground">{currentTrack.displayName}</p>
            <p className="text-muted-foreground">{currentTrack.metadata.author ?? 'Unknown'}</p>
          </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Year</span>
                <p>{currentTrack.metadata.released ?? '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Length</span>
                <p>{currentTrack.metadata.length ?? '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Song</span>
                <p>
                  {currentTrack.selectedSong}/{currentTrack.metadata.songs}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">SID Model</span>
                <p>{currentTrack.metadata.sidModel}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Size</span>
                <p>{(currentTrack.metadata.fileSizeBytes / 1024).toFixed(1)} KB</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
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
          </CardContent>
        </Card>
      )}

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">PREVIEW & QUEUE</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {previewSong && (
            <div className="rounded border border-border/60 bg-muted/30 p-3">
              <p className="text-[11px] text-muted-foreground uppercase">Preview</p>
              <p className="font-semibold text-foreground">{previewSong.title}</p>
              <p className="text-muted-foreground">{previewSong.artist}</p>
              <p className="text-muted-foreground">{previewSong.length}</p>
            </div>
          )}
          {nextSongs.length > 0 && (
            <div className="grid gap-2 md:grid-cols-3">
              {nextSongs.map((song, index) => (
                <div key={`${song.title}-${index}`} className="rounded border border-border/60 bg-muted/20 p-2">
                  <p className="font-semibold text-foreground">{song.title}</p>
                  <p className="text-muted-foreground">{song.artist}</p>
                  <p className="text-muted-foreground">{song.length}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
