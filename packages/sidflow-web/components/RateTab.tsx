'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  rateTrack,
  requestRandomRateTrack,
  controlRatePlayback,
  getRatePlaybackStatus,
  playManualTrack,
  type RateTrackInfo,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import type { RateRequest } from '@/lib/validation';
import {
  Shuffle,
  Music2,
  FileAudio2,
  Star,
  ThumbsUp,
  ThumbsDown,
  Play,
  Pause,
  SkipForward,
  SkipBack,
} from 'lucide-react';

interface RateTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function parseDurationSeconds(length?: string): number {
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

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.floor(seconds % 60));
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const DEFAULT_DURATION = 180;

export function RateTab({ onStatusChange }: RateTabProps) {
  const [currentTrack, setCurrentTrack] = useState<RateTrackInfo | null>(null);
  const [isFetchingTrack, setIsFetchingTrack] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<RateTrackInfo[]>([]);
  const [energy, setEnergy] = useState(3);
  const [mood, setMood] = useState(3);
  const [complexity, setComplexity] = useState(3);
  const [preference, setPreference] = useState(3);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const canGoBack = history.length > 0;

  const pushCurrentTrackToHistory = useCallback(() => {
    if (!currentTrack) {
      return;
    }
    setHistory((prev) => {
      const next = [...prev, currentTrack];
      if (next.length > 25) {
        next.shift();
      }
      return next;
    });
  }, [currentTrack]);

  const hasTrack = Boolean(currentTrack);
  const pollPlaybackStatus = useCallback(async () => {
    try {
      const response = await getRatePlaybackStatus();
      if (!response.success) {
        return;
      }
      const status = response.data;
      if (!status.active) {
        setIsPlaying(false);
        return;
      }
      if (typeof status.positionSeconds === 'number') {
        setPosition(status.positionSeconds);
      }
      if (status.durationSeconds) {
        setDuration(status.durationSeconds);
      }
      setIsPlaying(!status.isPaused);
    } catch (error) {
      console.error('[RateTab] Failed to poll playback status', error);
    }
  }, []);

  useEffect(() => {
    if (!currentTrack) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) {
        return;
      }
      await pollPlaybackStatus();
      if (!cancelled) {
        timer = setTimeout(tick, 1000);
      }
    };
    let timer = setTimeout(tick, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTrack, pollPlaybackStatus]);

  const seekTimeout = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
    };
  }, []);

  const handlePlayRandom = useCallback(async () => {
    setIsFetchingTrack(true);
    onStatusChange('Selecting a random SID and starting playback...');

    try {
      const response = await requestRandomRateTrack();
      if (!response.success) {
        onStatusChange(`Unable to start playback: ${formatApiError(response)}`, true);
        return;
      }

      const track = response.data.track;
      pushCurrentTrackToHistory();
      setCurrentTrack(track);
      setEnergy(3);
      setMood(3);
      setComplexity(3);
      setPreference(3);
      setDuration(track.durationSeconds ?? parseDurationSeconds(track.metadata.length));
      setPosition(0);
      setIsPlaying(true);

      onStatusChange(
        `Now playing "${track.displayName}" (song ${track.selectedSong}/${track.metadata.songs})`
      );
      await pollPlaybackStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Failed to start playback: ${message}`, true);
    } finally {
      setIsFetchingTrack(false);
    }
  }, [onStatusChange, pollPlaybackStatus, pushCurrentTrackToHistory]);

  const handlePlayPause = useCallback(async () => {
    if (!hasTrack) {
      return;
    }
    const action = isPlaying ? 'pause' : 'resume';
    const response = await controlRatePlayback({ action });
    if (response.success) {
      setIsPlaying(!isPlaying);
      onStatusChange(isPlaying ? 'Playback paused' : 'Playback resumed');
      await pollPlaybackStatus();
    } else {
      onStatusChange(`Playback control failed: ${formatApiError(response)}`, true);
    }
  }, [hasTrack, isPlaying, onStatusChange, pollPlaybackStatus]);

  const handlePreviousTrack = useCallback(async () => {
    if (!history.length) {
      return;
    }
    const previous = history[history.length - 1];
    try {
      const response = await playManualTrack({ sid_path: previous.sidPath });
      if (!response.success) {
        onStatusChange(`Unable to load previous SID: ${formatApiError(response)}`, true);
        return;
      }
      setHistory((prev) => prev.slice(0, -1));
      const track = response.data.track;
      setCurrentTrack(track);
      setDuration(track.durationSeconds ?? parseDurationSeconds(track.metadata.length));
      setPosition(0);
      setIsPlaying(true);
      onStatusChange(`Replaying "${track.displayName}"`);
      await pollPlaybackStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Unable to load previous SID: ${message}`, true);
    }
  }, [history, onStatusChange, pollPlaybackStatus]);

  const handleSkipForward = useCallback(async () => {
    if (isFetchingTrack) {
      return;
    }
    await handlePlayRandom();
  }, [handlePlayRandom, isFetchingTrack]);

  const sendSeek = useCallback(
    async (target: number) => {
      if (!hasTrack) {
        return;
      }
      const response = await controlRatePlayback({
        action: 'seek',
        positionSeconds: target,
      });
      if (response.success) {
        await pollPlaybackStatus();
      } else {
        onStatusChange(`Seek failed: ${formatApiError(response)}`, true);
      }
    },
    [hasTrack, onStatusChange, pollPlaybackStatus]
  );

  const handleSeek = useCallback(
    (value: number[]) => {
      if (!hasTrack) {
        return;
      }
      const next = Math.min(Math.max(0, value[0]), duration);
      setPosition(next);
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
      seekTimeout.current = setTimeout(() => {
        void sendSeek(next);
      }, 250);
    },
    [hasTrack, duration, sendSeek]
  );

  const handleLike = () => {
    setEnergy(5);
    setMood(5);
    setComplexity(5);
    setPreference(5);
  };

  const handleDislike = () => {
    setEnergy(1);
    setMood(1);
    setComplexity(1);
    setPreference(1);
  };

  const handleSubmit = useCallback(async () => {
    if (!currentTrack) {
      onStatusChange('Load and play a SID before submitting a rating', true);
      return;
    }

    setIsSubmitting(true);
    onStatusChange('Submitting rating...');

    try {
      const request: RateRequest = {
        sid_path: currentTrack.sidPath,
        ratings: {
          e: energy,
          m: mood,
          c: complexity,
          p: preference,
        },
      };

      const response = await rateTrack(request);

      if (response.success) {
        onStatusChange('Rating submitted! Loading the next SID...');
        await handlePlayRandom();
      } else {
        onStatusChange(`Rating failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(
        `Failed to submit rating: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [currentTrack, energy, mood, complexity, preference, onStatusChange, handlePlayRandom]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.metaKey
      ) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case ' ':
          event.preventDefault();
          handlePlayPause();
          break;
        case 'n':
          event.preventDefault();
          void handleSkipForward();
          break;
        case 'b':
          event.preventDefault();
          void handlePreviousTrack();
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handlePlayPause, handleSkipForward, handlePreviousTrack]);

  const ratingBlocks: Array<{
    label: string;
    description: string;
    value: number;
    setter: (value: number) => void;
  }> = [
    { label: 'ENERGY', description: '1 = Quiet • 5 = Intense', value: energy, setter: setEnergy },
    { label: 'MOOD', description: '1 = Dark • 5 = Bright', value: mood, setter: setMood },
    {
      label: 'COMPLEXITY',
      description: '1 = Simple • 5 = Dense',
      value: complexity,
      setter: setComplexity,
    },
    {
      label: 'PREFERENCE',
      description: '1 = Not my style • 5 = Love it',
      value: preference,
      setter: setPreference,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="c64-border">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="petscii-text text-accent">RATE TRACK</CardTitle>
              <CardDescription className="text-muted-foreground">
                Load an unrated SID, hear it instantly, and capture your feedback
              </CardDescription>
            </div>
            <Button
              onClick={handlePlayRandom}
              disabled={isFetchingTrack || isSubmitting}
              className="w-full md:w-auto retro-glow gap-2"
            >
              <Shuffle className="h-4 w-4" />
              {isFetchingTrack ? 'FINDING SID...' : 'PLAY RANDOM SID'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Slider
              value={[position]}
              onValueChange={handleSeek}
              min={0}
              max={Math.max(duration, 1)}
              step={1}
              disabled={!hasTrack}
              className="cursor-pointer"
            />
            <div className="flex justify-between text-xs font-mono text-muted-foreground">
              <span>{formatSeconds(position)}</span>
              <span>{formatSeconds(duration)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePreviousTrack}
                disabled={!canGoBack || isFetchingTrack}
                aria-label="Previous track"
                title={canGoBack ? 'Play the previously rated SID (shortcut: B)' : 'No previous SID'}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="icon"
                onClick={handlePlayPause}
                disabled={!hasTrack}
                aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleSkipForward}
                disabled={isFetchingTrack || isSubmitting}
                aria-label="Next track"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {currentTrack ? (
            <div className="rounded border border-border/60 bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Music2 className="h-4 w-4" />
                <span className="break-all">{currentTrack.relativePath}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">Title</span>
                  <p className="font-semibold text-foreground">{currentTrack.metadata.title}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Artist</span>
                  <p className="font-semibold text-foreground">
                    {currentTrack.metadata.author ?? 'Unknown'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Year</span>
                  <p>{currentTrack.metadata.released ?? 'Unknown'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Length</span>
                  <p>{currentTrack.metadata.length ?? 'Unknown'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">SID Model</span>
                  <p>{currentTrack.metadata.sidModel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">File Size</span>
                  <p>{formatBytes(currentTrack.metadata.fileSizeBytes)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded border border-dashed border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
              <FileAudio2 className="h-4 w-4" />
              Press “Play Random SID” to load the next unrated track.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">RATINGS</CardTitle>
          <CardDescription className="text-muted-foreground">
            Tap once per dimension, then submit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !hasTrack}
            className="w-full retro-glow"
          >
            {isSubmitting ? 'SUBMITTING...' : 'SUBMIT RATING'}
          </Button>

          <div className="grid gap-3 md:grid-cols-2">
            {ratingBlocks.map((block) => (
              <div key={block.label} className="rounded border border-border/60 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>{block.label}</span>
                  <span className="text-accent font-bold">{block.value}/5</span>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <Button
                      key={rating}
                      size="sm"
                      variant={block.value === rating ? 'default' : 'outline'}
                      onClick={() => block.setter(rating)}
                      className="flex-1 gap-1"
                      disabled={isSubmitting || !hasTrack}
                    >
                      <Star className={`h-3 w-3 ${block.value >= rating ? 'fill-current' : ''}`} />
                      {rating}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{block.description}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLike}
              className="gap-2"
              disabled={isSubmitting || !hasTrack}
              title="Set all ratings to 5"
            >
              <ThumbsUp className="h-4 w-4" />
              MAX ALL
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDislike}
              className="gap-2"
              disabled={isSubmitting || !hasTrack}
              title="Set all ratings to 1"
            >
              <ThumbsDown className="h-4 w-4" />
              MIN ALL
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
