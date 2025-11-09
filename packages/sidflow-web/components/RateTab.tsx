'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  rateTrack,
  requestRandomRateTrack,
  playManualTrack,
  getRatingHistory,
  type RatingHistoryEntry,
  type RateTrackInfo,
  type RateTrackWithSession,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import type { RateRequest } from '@/lib/validation';
import { SidflowPlayer } from '@/lib/player/sidflow-player';
import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
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

const HISTORY_PAGE_SIZE = 15;
type RatingValues = { e: number; m: number; c: number; p: number };

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
  const [currentSession, setCurrentSession] = useState<PlaybackSessionDescriptor | null>(null);
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
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
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
  const playerRef = useRef<SidflowPlayer | null>(null);
  const pendingLoadAbortRef = useRef<AbortController | null>(null);
  const ratingCacheRef = useRef<Map<string, RatingValues>>(new Map());
  const statusHandlerRef = useRef(onStatusChange);

  useEffect(() => {
    statusHandlerRef.current = onStatusChange;
  }, [onStatusChange]);

  const applyCachedRatings = useCallback(
    (sidPath?: string | null) => {
      if (!sidPath) {
        setEnergy(3);
        setMood(3);
        setComplexity(3);
        setPreference(3);
        return;
      }
      const cached = ratingCacheRef.current.get(sidPath);
      setEnergy(cached?.e ?? 3);
      setMood(cached?.m ?? 3);
      setComplexity(cached?.c ?? 3);
      setPreference(cached?.p ?? 3);
    },
    []
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setHistoryPage(1);
      setDebouncedHistoryQuery(historyQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [historyQuery]);

  useEffect(() => {
    const player = new SidflowPlayer();
    const handleProgress = (progress: number) => {
      setLoadProgress(progress);
    };
    const handleError = (error: Error) => {
      statusHandlerRef.current(`Playback error: ${error.message}`, true);
    };
    player.on('loadprogress', handleProgress);
    player.on('error', handleError);
    playerRef.current = player;

    return () => {
      pendingLoadAbortRef.current?.abort();
      player.off('loadprogress', handleProgress);
      player.off('error', handleError);
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const player = playerRef.current;
      if (player) {
        const nextDuration = player.getDurationSeconds();
        setDuration((prev) => {
          if (!Number.isFinite(nextDuration) || Math.abs(prev - nextDuration) < 0.1) {
            return prev;
          }
          return nextDuration;
        });
        const nextPosition = player.getPositionSeconds();
        setPosition((prev) => {
          if (Number.isNaN(nextPosition) || Math.abs(prev - nextPosition) < 0.05) {
            return prev;
          }
          return nextPosition;
        });
        const playing = player.getState() === 'playing';
        setIsPlaying((prev) => (prev === playing ? prev : playing));
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);

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

  const hasTrack = Boolean(currentTrack && currentSession);

  const loadTrackIntoPlayer = useCallback(
    async ({ track, session }: RateTrackWithSession, announcement?: string) => {
      const player = playerRef.current;
      if (!player) {
        onStatusChange('Playback engine not ready', true);
        return;
      }

      pendingLoadAbortRef.current?.abort();
      const abortController = new AbortController();
      pendingLoadAbortRef.current = abortController;
      setIsAudioLoading(true);
      setLoadProgress(0);

      try {
        await player.load({ track, session, signal: abortController.signal });
        setCurrentTrack(track);
        setCurrentSession(session);
        applyCachedRatings(track.sidPath);
        setPosition(0);
        setDuration(player.getDurationSeconds() || track.durationSeconds || DEFAULT_DURATION);
        await player.play();
        setIsPlaying(true);
        if (announcement) {
          onStatusChange(announcement);
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        onStatusChange(`Failed to prepare playback: ${message}`, true);
        throw error;
      } finally {
        if (pendingLoadAbortRef.current === abortController) {
          pendingLoadAbortRef.current = null;
        }
        setIsAudioLoading(false);
      }
    },
    [applyCachedRatings, onStatusChange]
  );

  const seekTimeout = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
    };
  }, []);

  const playSidFile = useCallback(
    async (sidPath: string, announcement?: string) => {
      setIsFetchingTrack(true);
      try {
        const response = await playManualTrack({ sid_path: sidPath });
        if (!response.success) {
          onStatusChange(`Unable to load SID: ${formatApiError(response)}`, true);
          return;
        }
        await loadTrackIntoPlayer(response.data, announcement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onStatusChange(`Unable to load SID: ${message}`, true);
      } finally {
        setIsFetchingTrack(false);
      }
    },
    [loadTrackIntoPlayer, onStatusChange]
  );

  const handlePlayRandom = useCallback(async () => {
    if (isFetchingTrack || isAudioLoading) {
      return;
    }
    setIsFetchingTrack(true);
    onStatusChange('Selecting a random SID and preparing playback...');

    try {
      const response = await requestRandomRateTrack();
      if (!response.success) {
        onStatusChange(`Unable to start playback: ${formatApiError(response)}`, true);
        return;
      }

      pushCurrentTrackToHistory();
      const payload = response.data;
      const track = payload.track;
      await loadTrackIntoPlayer(
        payload,
        `Now playing "${track.displayName}" (song ${track.selectedSong}/${track.metadata.songs})`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Failed to start playback: ${message}`, true);
    } finally {
      setIsFetchingTrack(false);
    }
  }, [isAudioLoading, isFetchingTrack, loadTrackIntoPlayer, onStatusChange, pushCurrentTrackToHistory]);

  const handlePlayPause = useCallback(async () => {
    const player = playerRef.current;
    if (!hasTrack || !player || isAudioLoading) {
      return;
    }
    const state = player.getState();
    if (state === 'playing') {
      player.pause();
      onStatusChange('Playback paused');
      return;
    }
    try {
      await player.play();
      onStatusChange('Playback resumed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Unable to resume playback: ${message}`, true);
    }
  }, [hasTrack, isAudioLoading, onStatusChange]);

  const handlePreviousTrack = useCallback(async () => {
    if (!trackHistory.length) {
      return;
    }
    const previous = trackHistory[trackHistory.length - 1];
    setTrackHistory((prev) => prev.slice(0, -1));
    await playSidFile(previous.sidPath, `Replaying "${previous.displayName}"`);
  }, [trackHistory, playSidFile]);

  const handleSkipForward = useCallback(async () => {
    if (isFetchingTrack || isAudioLoading) {
      return;
    }
    await handlePlayRandom();
  }, [handlePlayRandom, isAudioLoading, isFetchingTrack]);

  const sendSeek = useCallback(
    (target: number) => {
      const player = playerRef.current;
      if (!player) {
        return;
      }
      player.seek(target);
    },
    []
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
        sendSeek(next);
      }, 180);
    },
    [duration, hasTrack, sendSeek]
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
          setHistoryData((prev) => {
            if (prev && response.data.page === prev.page && response.data.pageSize === prev.pageSize) {
              const existing = prev.items.reduce<Record<string, RatingHistoryEntry>>((acc, item) => {
                acc[item.sidPath] = item;
                return acc;
              }, {});
              const mergedItems = response.data.items.map((item) => {
                ratingCacheRef.current.set(item.sidPath, {
                  e: clampRatingValue(item.ratings.e),
                  m: clampRatingValue(item.ratings.m),
                  c: clampRatingValue(item.ratings.c),
                  p: clampRatingValue(item.ratings.p),
                });
                if (existing[item.sidPath] && existing[item.sidPath].timestamp === item.timestamp) {
                  return existing[item.sidPath];
                }
                return item;
              });
              return {
                ...response.data,
                items: mergedItems,
              };
            }
            response.data.items.forEach((entry) => {
              ratingCacheRef.current.set(entry.sidPath, {
                e: clampRatingValue(entry.ratings.e),
                m: clampRatingValue(entry.ratings.m),
                c: clampRatingValue(entry.ratings.c),
                p: clampRatingValue(entry.ratings.p),
              });
            });
            return response.data;
          });
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

  const randomButtonLabel = isFetchingTrack
    ? 'FINDING SID...'
    : isAudioLoading
      ? `PREPARING AUDIO${loadProgress > 0 ? ` (${Math.round(loadProgress * 100)}%)` : '...'}`
      : 'PLAY RANDOM SID';

  const randomButtonIcon = isFetchingTrack || isAudioLoading
    ? <Loader2 className="h-4 w-4 animate-spin" />
    : <Shuffle className="h-4 w-4" />;

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
        ratingCacheRef.current.set(currentTrack.sidPath, {
          e: energy,
          m: mood,
          c: complexity,
          p: preference,
        });
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
                disabled={isFetchingTrack || isSubmitting || isAudioLoading}
                className="w-full md:w-auto retro-glow gap-2 peer"
              >
                {randomButtonIcon}
                {randomButtonLabel}
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
                disabled={!canGoBack || isFetchingTrack || isAudioLoading}
                aria-label="Previous track"
                title={canGoBack ? 'Play the previously rated SID (shortcut: B)' : 'No previous SID'}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="icon"
                onClick={handlePlayPause}
                disabled={!hasTrack || isAudioLoading}
                aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleSkipForward}
                disabled={isFetchingTrack || isSubmitting || isAudioLoading}
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
                disabled={!hasTrack || isAudioLoading}
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
                disabled={isSubmitting || !hasTrack || isAudioLoading}
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
                      disabled={isSubmitting || !hasTrack || isAudioLoading}
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
              disabled={isSubmitting || !hasTrack || isAudioLoading}
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
              disabled={isSubmitting || !hasTrack || isAudioLoading}
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
                Search, replay, and refine previous feedback.
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
            <div className="overflow-x-auto">
              <table className="w-full text-xs md:text-sm border border-border/60 rounded table-fixed">
                <thead className="bg-muted/40 text-muted-foreground uppercase tracking-tight text-[10px] md:text-[11px]">
                  <tr>
                    <th className="px-1.5 py-1 text-left">Play</th>
                    <th className="px-1.5 py-1 text-left">SID Path</th>
                    {RATING_DIMENSIONS.map((dimension) => (
                      <th key={dimension.key} className="px-1 py-1 text-center">
                        {dimension.label}
                      </th>
                    ))}
                    <th className="px-1.5 py-1 text-right">Updated</th>
                  </tr>
                </thead>
                <tbody className="align-middle text-[11px] md:text-xs">
                  {historyItems.map((entry) => {
                    const isActive = currentTrack?.sidPath === entry.sidPath;
                    const isEntryPlaying = isActive && isPlaying;
                    const handlePlayClick = () => {
                      if (isAudioLoading || isFetchingTrack) {
                        return;
                      }
                      if (isActive) {
                        handlePlayPause();
                      } else {
                        pushCurrentTrackToHistory();
                        void playSidFile(entry.sidPath, `Loaded ${entry.filename}`);
                      }
                    };
                    return (
                      <tr key={entry.id} className="border-t border-border/40 transition-opacity duration-100 ease-out">
                        <td className="px-1.5 py-1">
                          <Button
                            size="icon"
                            variant={isEntryPlaying ? 'default' : 'outline'}
                            onClick={handlePlayClick}
                            title={isEntryPlaying ? 'Pause playback' : 'Play this SID'}
                            className="h-6 w-6 rounded-full"
                            disabled={isAudioLoading || isFetchingTrack}
                          >
                            {isEntryPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                          </Button>
                        </td>
                        <td className="px-1.5 py-1 font-mono">
                          <div className="truncate" title={entry.relativePath}>
                            {entry.relativePath}
                          </div>
                        </td>
                        {RATING_DIMENSIONS.map((dimension) => {
                          const currentValue = clampRatingValue(entry.ratings[dimension.key]);
                          const handleDropdownChange = async (
                            event: ChangeEvent<HTMLSelectElement>
                          ) => {
                            const next = clampRatingValue(Number(event.target.value));
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

                            const payload = {
                              sid_path: entry.sidPath,
                              ratings: {
                                e: dimension.key === 'e' ? next : clampRatingValue(entry.ratings.e),
                                m: dimension.key === 'm' ? next : clampRatingValue(entry.ratings.m),
                                c: dimension.key === 'c' ? next : clampRatingValue(entry.ratings.c),
                                p: dimension.key === 'p' ? next : clampRatingValue(entry.ratings.p),
                              },
                            };
                            ratingCacheRef.current.set(entry.sidPath, {
                              e: payload.ratings.e,
                              m: payload.ratings.m,
                              c: payload.ratings.c,
                              p: payload.ratings.p,
                            });
                            try {
                              const response = await rateTrack(payload);
                              if (!response.success) {
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
                            <td key={`${entry.id}-${dimension.key}`} className="px-1 py-1 text-center">
                              <select
                                value={currentValue}
                                onChange={handleDropdownChange}
                                className="w-12 rounded border border-border/60 bg-card px-1 py-0.5 text-xs font-mono"
                                title={dimension.title}
                              >
                                {[1, 2, 3, 4, 5].map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                        <td className="px-1.5 py-1 text-right text-muted-foreground text-[10px] md:text-[11px]">
                          {formatHistoryTimestamp(entry.timestamp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
