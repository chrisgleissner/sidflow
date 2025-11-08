'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  rateTrack,
  requestRandomRateTrack,
  controlRatePlayback,
  getRatePlaybackStatus,
  playManualTrack,
  getRatingHistory,
  type RatingHistoryEntry,
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
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';

interface RateTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

type RatingDimension = 'e' | 'm' | 'c' | 'p';

const RATING_DIMENSIONS: Array<{ key: RatingDimension; label: string; title: string }> = [
  { key: 'e', label: 'E', title: 'Energy' },
  { key: 'm', label: 'M', title: 'Mood' },
  { key: 'c', label: 'C', title: 'Complexity' },
  { key: 'p', label: 'P', title: 'Preference' },
];

const HISTORY_PAGE_SIZE = 8;

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

function clampRatingValue(value: number | undefined, fallback = 3): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(5, Math.max(1, Math.round(value)));
}

function formatHistoryTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground uppercase tracking-tight">{label}</span>
      <span className="font-semibold text-foreground text-right break-words">{value}</span>
    </div>
  );
}

const DEFAULT_DURATION = 180;

export function RateTab({ onStatusChange }: RateTabProps) {
  const [currentTrack, setCurrentTrack] = useState<RateTrackInfo | null>(null);
  const [isFetchingTrack, setIsFetchingTrack] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [trackHistory, setTrackHistory] = useState<RateTrackInfo[]>([]);
  const [energy, setEnergy] = useState(3);
  const [mood, setMood] = useState(3);
  const [complexity, setComplexity] = useState(3);
  const [preference, setPreference] = useState(3);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [historyData, setHistoryData] = useState<{
    total: number;
    page: number;
    pageSize: number;
    items: RatingHistoryEntry[];
  } | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyQuery, setHistoryQuery] = useState('');
  const [debouncedHistoryQuery, setDebouncedHistoryQuery] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const canGoBack = trackHistory.length > 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      setHistoryPage(1);
      setDebouncedHistoryQuery(historyQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [historyQuery]);

  const pushCurrentTrackToHistory = useCallback(() => {
    if (!currentTrack) {
      return;
    }
    setTrackHistory((prev) => {
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
        return null;
      }
      const status = response.data;
      if (!status.active) {
        setIsPlaying(false);
        return status;
      }
      const nextPosition =
        typeof status.positionSeconds === 'number' ? status.positionSeconds : 0;
      setPosition(nextPosition);
      const durationOverride = status.track?.durationSeconds ?? status.durationSeconds;
      if (typeof durationOverride === 'number' && Number.isFinite(durationOverride)) {
        setDuration(durationOverride);
      }
      setIsPlaying(!status.isPaused);
      if (status.track) {
        setCurrentTrack(status.track);
      }
      return status;
    } catch (error) {
      console.error('[RateTab] Failed to poll playback status', error);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      const status = await pollPlaybackStatus();
      const delay = status?.active ? 1000 : 4000;
      timer = setTimeout(tick, delay);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [pollPlaybackStatus]);

  const seekTimeout = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
    };
  }, []);

  const updateTrackStateFromResponse = useCallback(
    async (track: RateTrackInfo, announcement?: string) => {
      setCurrentTrack(track);
      setDuration(track.durationSeconds ?? parseDurationSeconds(track.metadata.length));
      setPosition(0);
      setIsPlaying(true);
      if (announcement) {
        onStatusChange(announcement);
      }
      await pollPlaybackStatus();
    },
    [onStatusChange, pollPlaybackStatus]
  );

  const playSidFile = useCallback(
    async (sidPath: string, announcement?: string) => {
      try {
        const response = await playManualTrack({ sid_path: sidPath });
        if (!response.success) {
          onStatusChange(`Unable to load SID: ${formatApiError(response)}`, true);
          return;
        }
        await updateTrackStateFromResponse(response.data.track, announcement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onStatusChange(`Unable to load SID: ${message}`, true);
      }
    },
    [onStatusChange, updateTrackStateFromResponse]
  );

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
    if (!trackHistory.length) {
      return;
    }
    const previous = trackHistory[trackHistory.length - 1];
    setTrackHistory((prev) => prev.slice(0, -1));
    await playSidFile(previous.sidPath, `Replaying "${previous.displayName}"`);
  }, [trackHistory, playSidFile]);

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

  const fetchRatingsHistory = useCallback(
    async (page: number, query: string) => {
      setIsHistoryLoading(true);
      try {
        const response = await getRatingHistory({
          page,
          pageSize: HISTORY_PAGE_SIZE,
          query: query.length > 0 ? query : undefined,
        });
        if (response.success) {
          setHistoryData(response.data);
          if (response.data.page !== page) {
            setHistoryPage(response.data.page);
          }
        } else {
          onStatusChange(`Unable to load ratings: ${formatApiError(response)}`, true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onStatusChange(`Unable to load ratings: ${message}`, true);
      } finally {
        setIsHistoryLoading(false);
      }
    },
    [onStatusChange]
  );

  useEffect(() => {
    void fetchRatingsHistory(historyPage, debouncedHistoryQuery);
  }, [fetchRatingsHistory, historyPage, debouncedHistoryQuery]);

  const refreshRatingHistory = useCallback(() => {
    void fetchRatingsHistory(historyPage, debouncedHistoryQuery);
  }, [fetchRatingsHistory, historyPage, debouncedHistoryQuery]);

  const ratingBlocks: Array<{
    label: string;
    description: string;
    hints: [string, string, string, string, string];
    value: number;
    setter: (value: number) => void;
  }> = [
    {
      label: 'ENERGY',
      description: '1 = Quiet • 5 = Intense',
      hints: ['Quiet', 'Chill', 'Balanced', 'Driving', 'Intense'],
      value: energy,
      setter: setEnergy,
    },
    {
      label: 'MOOD',
      description: '1 = Dark • 5 = Bright',
      hints: ['Gloomy', 'Dark', 'Neutral', 'Upbeat', 'Bright'],
      value: mood,
      setter: setMood,
    },
    {
      label: 'COMPLEXITY',
      description: '1 = Simple • 5 = Dense',
      hints: ['Minimal', 'Light', 'Layered', 'Busy', 'Dense'],
      value: complexity,
      setter: setComplexity,
    },
    {
      label: 'PREFERENCE',
      description: '1 = Not my style • 5 = Love it',
      hints: ['Skip it', 'Meh', 'Okay', 'Like it', 'Love it'],
      value: preference,
      setter: setPreference,
    },
  ];

  const historyItems = historyData?.items ?? [];
  const historyTotalPages = historyData
    ? Math.max(1, Math.ceil(historyData.total / historyData.pageSize))
    : 1;
  const historyRangeStart =
    historyData && historyData.total > 0 ? (historyData.page - 1) * historyData.pageSize + 1 : 0;
  const historyRangeEnd =
    historyData && historyData.total > 0
      ? Math.min(historyData.total, historyData.page * historyData.pageSize)
      : 0;

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
        refreshRatingHistory();
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
  }, [
    currentTrack,
    energy,
    mood,
    complexity,
    preference,
    onStatusChange,
    handlePlayRandom,
    refreshRatingHistory,
  ]);

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
            <div className="relative">
              <Button
                onClick={handlePlayRandom}
                disabled={isFetchingTrack || isSubmitting}
                className="w-full md:w-auto retro-glow gap-2 peer"
              >
                <Shuffle className="h-4 w-4" />
                {isFetchingTrack ? 'FINDING SID...' : 'PLAY RANDOM SID'}
              </Button>
              <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-max -translate-x-1/2 rounded bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow peer-hover:block">
                Load an unrated SID from your collection and start playback instantly
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-8">
            <div className="flex items-center gap-2">
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
            <div className="flex-1 w-full">
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
            </div>
          </div>

          {currentTrack ? (
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
              <div className="flex flex-col gap-4 text-xs md:flex-row md:items-stretch md:gap-12">
                  <div className="flex-1 space-y-2">
                  <MetaRow label="Title" value={currentTrack.metadata.title ?? 'Unknown'} />
                  <MetaRow label="Artist" value={currentTrack.metadata.author ?? 'Unknown'} />
                  <MetaRow label="Year" value={currentTrack.metadata.released ?? 'Unknown'} />
                  <MetaRow
                    label="Song"
                    value={`${currentTrack.selectedSong}/${currentTrack.metadata.songs}`}
                  />
                </div>
                <div className="hidden md:block w-px bg-border/60 md:mx-6 lg:mx-10" aria-hidden="true" />
                <div className="flex-1 space-y-2">
                  <MetaRow label="Length" value={currentTrack.metadata.length ?? 'Unknown'} />
                  <MetaRow
                    label="File Size"
                    value={formatBytes(currentTrack.metadata.fileSizeBytes)}
                  />
                  <MetaRow label="SID Model" value={currentTrack.metadata.sidModel} />
                </div>
              </div>
            </div>
          ) : (
          <div className="flex items-center gap-2 rounded border border-dashed border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            <FileAudio2 className="h-4 w-4" />
            No track loaded yet.
          </div>
          )}
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm petscii-text text-accent">RATINGS</CardTitle>
              <CardDescription className="text-muted-foreground">
                Score each dimension once before submitting your feedback.
              </CardDescription>
            </div>
            <div className="relative">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !hasTrack}
                className="w-full md:w-auto retro-glow peer"
              >
                {isSubmitting ? 'SUBMITTING...' : 'SUBMIT RATING'}
              </Button>
              <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden w-max rounded bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow peer-hover:block">
                Store this rating and instantly load the next SID
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-2">
            {ratingBlocks.map((block) => (
              <div
                key={block.label}
                className="rounded border border-border/60 bg-muted/30 p-2 space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span title={block.description}>{block.label}</span>
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
                      title={`${block.label}: ${block.hints[rating - 1]}`}
                      aria-label={`${block.label} ${rating} – ${block.hints[rating - 1]}`}
                    >
                      <Star className={`h-3 w-3 ${block.value >= rating ? 'fill-current' : ''}`} />
                      {rating}
                    </Button>
                  ))}
                </div>
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

      <Card className="c64-border">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm petscii-text text-accent">YOUR RATED TRACKS</CardTitle>
              <CardDescription className="text-muted-foreground">
                Search, replay, and fine-tune previous feedback without leaving the tab.
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
              <div className="relative w-full md:w-64">
                <Input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="Filter by path or filename"
                  className="pl-8"
                />
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {historyData && historyData.total > 0 ? (
                  <span>
                    Showing {historyRangeStart}–{historyRangeEnd} of {historyData.total}
                  </span>
                ) : (
                  <span>No ratings yet</span>
                )}
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                    disabled={historyPage <= 1 || isHistoryLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setHistoryPage((page) => Math.min(historyTotalPages, page + 1))
                    }
                    disabled={historyPage >= historyTotalPages || isHistoryLoading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <div className="min-w-[640px] space-y-1 text-[11px] md:text-xs">
              <div className="grid items-center gap-2 rounded border border-border/60 bg-muted/30 px-2 py-1 font-semibold uppercase text-muted-foreground grid-cols-[auto,minmax(0,1.6fr),repeat(4,110px),110px]">
                <span>Play</span>
                <span>SID FILE</span>
                {RATING_DIMENSIONS.map((dimension) => (
                  <span key={dimension.key} title={dimension.title} className="text-center">
                    {dimension.label}
                  </span>
                ))}
                <span className="text-right">Updated</span>
              </div>
              {isHistoryLoading ? (
                <div className="flex items-center justify-center gap-2 rounded border border-dashed border-border/60 px-3 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading ratings…
                </div>
              ) : historyItems.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 px-3 py-4 text-muted-foreground">
                  Once you submit ratings, they will appear here for quick adjustments.
                </div>
              ) : (
                historyItems.map((entry) => {
                  const isActive = currentTrack?.sidPath === entry.sidPath;
                  const isEntryPlaying = isActive && isPlaying;
                  const handlePlayClick = () => {
                    if (isActive) {
                      handlePlayPause();
                    } else {
                      void playSidFile(entry.sidPath, `Loaded ${entry.filename}`);
                    }
                  };
                  return (
                    <div
                      key={entry.id}
                      className="grid items-center gap-2 rounded border border-border/40 px-2 py-1 grid-cols-[auto,minmax(0,1.6fr),repeat(4,110px),110px]"
                    >
                      <Button
                        size="icon"
                        variant={isEntryPlaying ? 'default' : 'outline'}
                        onClick={handlePlayClick}
                        title={isEntryPlaying ? 'Pause playback' : 'Play this SID'}
                      >
                        {isEntryPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                      <div className="truncate font-mono" title={entry.relativePath}>
                        {entry.relativePath}
                      </div>
                      {RATING_DIMENSIONS.map((dimension) => {
                        const currentValue = clampRatingValue(entry.ratings[dimension.key]);
                        const handleSliderChange = (value: number[]) => {
                          const next = clampRatingValue(value[0]);
                          setHistoryData((prev) => {
                            if (!prev) {
                              return prev;
                            }
                            return {
                              ...prev,
                              items: prev.items.map((item) =>
                                item.id === entry.id
                                  ? {
                                      ...item,
                                      ratings: {
                                        ...item.ratings,
                                        [dimension.key]: next,
                                      },
                                    }
                                  : item
                              ),
                            };
                          });
                        };
                        const handleSliderCommit = async (value: number[]) => {
                          const next = clampRatingValue(value[0]);
                          const payload = {
                            sid_path: entry.sidPath,
                            ratings: {
                              e: dimension.key === 'e' ? next : clampRatingValue(entry.ratings.e),
                              m: dimension.key === 'm' ? next : clampRatingValue(entry.ratings.m),
                              c: dimension.key === 'c' ? next : clampRatingValue(entry.ratings.c),
                              p: dimension.key === 'p' ? next : clampRatingValue(entry.ratings.p),
                            },
                          };
                          try {
                            const response = await rateTrack(payload);
                            if (response.success) {
                              onStatusChange(
                                `${dimension.title} updated for ${entry.filename} (${next}/5)`
                              );
                              refreshRatingHistory();
                            } else {
                              onStatusChange(
                                `Failed to update ${dimension.title}: ${formatApiError(response)}`,
                                true
                              );
                              refreshRatingHistory();
                            }
                          } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            onStatusChange(
                              `Failed to update ${dimension.title}: ${message}`,
                              true
                            );
                            refreshRatingHistory();
                          }
                        };
                        return (
                          <div
                            key={`${entry.id}-${dimension.key}`}
                            className="flex items-center gap-2"
                            title={`${dimension.title}: ${currentValue}/5`}
                          >
                            <Slider
                              value={[currentValue]}
                              onValueChange={handleSliderChange}
                              onValueCommit={handleSliderCommit}
                              min={1}
                              max={5}
                              step={1}
                              className="flex-1"
                            />
                            <span className="w-6 text-right font-mono">{currentValue}</span>
                          </div>
                        );
                      })}
                      <div className="text-right text-muted-foreground">
                        {formatHistoryTimestamp(entry.timestamp)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
