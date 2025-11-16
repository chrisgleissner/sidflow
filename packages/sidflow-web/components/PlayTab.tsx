'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  playManualTrack,
  rateTrack,
  requestRandomPlayTrack,
  requestStationFromSong,
  getAggregateRating,
  type RateTrackInfo,
  type RateTrackWithSession,
  type AggregateRating,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import { SidflowPlayer, type SidflowPlayerState } from '@/lib/player/sidflow-player';
import { Play, Pause, SkipForward, SkipBack, ThumbsUp, ThumbsDown, Forward, Music2, Loader2, AlertTriangle, Volume2, VolumeX, Radio, Star, TrendingUp, Settings } from 'lucide-react';
import type { FeedbackAction } from '@sidflow/common';
import { recordExplicitRating, recordImplicitAction } from '@/lib/feedback/recorder';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  dedupeBySidPath,
  formatSeconds,
  parseLengthSeconds,
  type PlaylistTrack,
} from '@/components/play-tab-helpers';
import { usePreferences } from '@/context/preferences-context';
import { useNetworkStatus } from '@/lib/offline/network-status';
import { cacheTrack, listCachedTracks } from '@/lib/offline/playback-cache';
import {
  countPendingPlaybackRequests,
  enqueuePlayNext,
  enqueuePlaylistRebuild,
  flushPlaybackQueue,
} from '@/lib/offline/playback-queue';
import { SongBrowser } from '@/components/SongBrowser';
import { buildSongPlaylist, buildFolderPlaylist, getPlaylistModeDescription, type PlaylistTrackItem } from '@/lib/playlist-builder';
import { getPersonalRating, setPersonalRating, type PersonalRating } from '@/lib/personal-ratings';

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

// Map presets to E/M/C mood vectors
const PRESET_TO_EMC: Record<MoodPreset, { e: number; m: number; c: number }> = {
  quiet: { e: 1.5, m: 3.0, c: 2.0 },      // Low energy, neutral mood, simple
  ambient: { e: 2.0, m: 3.5, c: 2.5 },    // Low-medium energy, slightly uplifting
  energetic: { e: 4.5, m: 4.0, c: 3.5 },  // High energy, uplifting, moderate complexity
  dark: { e: 2.5, m: 1.5, c: 3.0 },       // Medium energy, melancholic, somewhat complex
  bright: { e: 4.0, m: 4.5, c: 3.0 },     // High energy, very uplifting
  complex: { e: 3.0, m: 3.0, c: 4.5 },    // Medium energy, neutral mood, highly complex
};

// Era presets for decade-based exploration
const ERA_PRESETS: Record<'1980s' | '1990s' | '2000s' | 'golden', { start: number; end: number; label: string }> = {
  '1980s': { start: 1980, end: 1989, label: '1980s SID Hits' },
  '1990s': { start: 1990, end: 1999, label: '1990s Classics' },
  '2000s': { start: 2000, end: 2009, label: '2000s Era' },
  'golden': { start: 1985, end: 1992, label: 'Golden Age (1985-1992)' },
};

const HISTORY_LIMIT = 3;
const UPCOMING_DISPLAY_LIMIT = 3;
const INITIAL_PLAYLIST_SIZE = 12;
const PREFETCH_WAIT_MS = 3000;

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

export function PlayTab({ onStatusChange, onTrackPlayed }: PlayTabProps) {
  const { preferences } = usePreferences();
  const { isOnline } = useNetworkStatus();
  const [preset, setPreset] = useState<MoodPreset>('energetic');
  const [currentTrack, setCurrentTrack] = useState<PlaylistTrack | null>(null);
  const [duration, setDuration] = useState(180);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRating, setIsRating] = useState(false);
  const [playedTracks, setPlayedTracks] = useState<PlaylistTrack[]>([]);
  const [upcomingTracks, setUpcomingTracks] = useState<PlaylistTrack[]>([]);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isPauseReady, setIsPauseReady] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [playbackMode, setPlaybackMode] = useState<'mood' | 'folder' | 'song'>('mood');
  const [playbackModeDescription, setPlaybackModeDescription] = useState<string>('Mood Station');
  const [aggregateRating, setAggregateRating] = useState<AggregateRating | null>(null);
  const [personalRating, setPersonalRatingState] = useState<PersonalRating | null>(null);
  const [stationSimilarity, setStationSimilarity] = useState(0.7);
  const [stationDiscovery, setStationDiscovery] = useState(0.5);
  const [showStationSettings, setShowStationSettings] = useState(false);
  const [showMoodTransition, setShowMoodTransition] = useState(false);
  const [transitionStart, setTransitionStart] = useState<MoodPreset>('quiet');
  const [transitionEnd, setTransitionEnd] = useState<MoodPreset>('energetic');
  const [showEraExplorer, setShowEraExplorer] = useState(false);
  const [eraPreset, setEraPreset] = useState<'1980s' | '1990s' | '2000s' | 'golden' | 'custom'>('golden');
  const [customYearStart, setCustomYearStart] = useState(1985);
  const [customYearEnd, setCustomYearEnd] = useState(1992);
  const [showComposerDiscovery, setShowComposerDiscovery] = useState(false);
  const [similarComposers, setSimilarComposers] = useState<Array<{ composer: string; similarity_score: number }>>([]);
  const [isLoadingHiddenGems, setIsLoadingHiddenGems] = useState(false);
  const [showChipModelSelector, setShowChipModelSelector] = useState(false);
  const [isLoadingChipStation, setIsLoadingChipStation] = useState(false);
  const isAudioLoadingRef = useRef(isAudioLoading);
  const isOnlineRef = useRef(isOnline);
  const isMountedRef = useRef(true);
  const queueProcessingRef = useRef(false);
  const { maxEntries: maxCacheEntries, preferOffline: preferOfflineCache } = preferences.localCache;

  const seekTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const refreshQueueCount = useCallback(async () => {
    const count = await countPendingPlaybackRequests();
    console.debug('[PlayTab] refreshQueueCount', { count });
    if (isMountedRef.current) {
      setPendingQueueCount(count);
    }
  }, []);

  useEffect(() => {
    void refreshQueueCount();
  }, [refreshQueueCount]);
  const playlistCounterRef = useRef(1);
  const trackNumberMapRef = useRef<Map<string, number>>(new Map());
  const playedRef = useRef<PlaylistTrack[]>([]);
  const upcomingRef = useRef<PlaylistTrack[]>([]);
  const currentTrackRef = useRef<PlaylistTrack | null>(null);
  const playerRef = useRef<SidflowPlayer | null>(null);
  const pendingLoadAbortRef = useRef<AbortController | null>(null);
  const playNextHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const rebuildPlaylistRef = useRef<(() => Promise<void>) | null>(null);
  const prefetchedSessionsRef = useRef<Map<string, RateTrackWithSession>>(new Map());
  const prefetchPromisesRef = useRef<Map<string, Promise<void>>>(new Map());

  const getPipelineKind = useCallback(() => playerRef.current?.getPipelineKind() ?? null, []);

  const recordImplicitForCurrent = useCallback(
    (action: FeedbackAction, metadata: Record<string, unknown>) => {
      const track = currentTrackRef.current;
      if (!track) {
        return;
      }
      recordImplicitAction({
        track,
        action,
        sessionId: playerRef.current?.getSession()?.sessionId,
        pipeline: getPipelineKind(),
        metadata,
      });
    },
    [getPipelineKind]
  );

  const applyUpcoming = useCallback(
    (nextTracks: PlaylistTrack[]) => {
      const uniqueTracks = dedupeBySidPath(nextTracks);
      upcomingRef.current = uniqueTracks;
      setUpcomingTracks(uniqueTracks.slice(0, UPCOMING_DISPLAY_LIMIT));
      return uniqueTracks;
    },
    [setUpcomingTracks]
  );

  const updateUpcoming = useCallback(
    (mutator: (queue: PlaylistTrack[]) => PlaylistTrack[]) => {
      const baseQueue = upcomingRef.current.slice();
      return applyUpcoming(mutator(baseQueue));
    },
    [applyUpcoming]
  );

  useEffect(() => {
    playedRef.current = playedTracks;
  }, [playedTracks]);

  useEffect(() => {
    upcomingRef.current = upcomingTracks;
  }, [upcomingTracks]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  const recomputePauseReady = useCallback((origin: string) => {
    const hasTrack = Boolean(currentTrackRef.current);
    const playerState = playerRef.current?.getState();
    const ready =
      hasTrack &&
      (playerState === 'playing' || playerState === 'paused' || playerState === 'ready' || playerState === 'ended');
    console.debug('[PlayTab] Pause readiness recalculated', {
      origin,
      ready,
      hasTrack,
      isAudioLoading: isAudioLoadingRef.current,
      playerState,
    });
    setIsPauseReady(ready);
  }, []);

  useEffect(() => {
    isAudioLoadingRef.current = isAudioLoading;
    recomputePauseReady('is-audio-loading-change');
  }, [isAudioLoading, recomputePauseReady]);

  useEffect(() => {
    recomputePauseReady('current-track-change');
  }, [currentTrack, recomputePauseReady]);

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

  useEffect(() => {
    const player = new SidflowPlayer();
    const handleProgress = (progress: number) => {
      setLoadProgress(progress);
    };
    const handleError = (error: Error) => {
      statusHandlerRef.current(`Playback error: ${error.message}`, true);
    };
    const handleState = (state: SidflowPlayerState) => {
      if (state === 'ended') {
        setIsPlaying(false);
        setPosition((prev) => {
          const currentPlayer = playerRef.current;
          if (!currentPlayer) {
            return prev;
          }
          const nextDuration = currentPlayer.getDurationSeconds();
          return Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : prev;
        });
        const next = playNextHandlerRef.current;
        if (next) {
          void next();
        }
      }
      recomputePauseReady(`player-statechange:${state}`);
    };

    player.on('loadprogress', handleProgress);
    player.on('error', handleError);
    player.on('statechange', handleState);
    playerRef.current = player;
    if (typeof window !== 'undefined') {
      (window as unknown as { __sidflowPlayer?: SidflowPlayer }).__sidflowPlayer = player;
    }
    recomputePauseReady('player-initialized');

    return () => {
      pendingLoadAbortRef.current?.abort();
      player.off('loadprogress', handleProgress);
      player.off('error', handleError);
      player.off('statechange', handleState);
      player.destroy();
      if (typeof window !== 'undefined') {
        const globalWindow = window as unknown as { __sidflowPlayer?: SidflowPlayer };
        if (globalWindow.__sidflowPlayer === player) {
          delete globalWindow.__sidflowPlayer;
        }
      }
      playerRef.current = null;
    };
  }, [recomputePauseReady]);

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const player = playerRef.current;
      if (player) {
        const durationSeconds = player.getDurationSeconds();
        if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
          setDuration((prev) => (Math.abs(prev - durationSeconds) < 0.1 ? prev : durationSeconds));
        }
        const positionSeconds = player.getPositionSeconds();
        if (Number.isFinite(positionSeconds)) {
          setPosition(positionSeconds);
        }
        const state = player.getState();
        const playing = state === 'playing';
        setIsPlaying((prev) => (prev === playing ? prev : playing));
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  const notifyStatus = useCallback((message: string, isError = false) => {
    statusHandlerRef.current(message, isError);
  }, []);

  const notifyTrackPlayed = useCallback((sidPath: string) => {
    trackPlayedHandlerRef.current(sidPath);
  }, []);

  // Fetch aggregate and personal rating when current track changes
  useEffect(() => {
    if (!currentTrack) {
      setAggregateRating(null);
      setPersonalRatingState(null);
      return;
    }

    let cancelled = false;

    const fetchRatings = async () => {
      try {
        // Fetch aggregate rating from server
        const response = await getAggregateRating(currentTrack.sidPath);
        if (response.success && !cancelled) {
          setAggregateRating(response.data);
        }

        // Fetch personal rating from localStorage
        const personal = getPersonalRating(currentTrack.sidPath);
        if (!cancelled) {
          setPersonalRatingState(personal);
        }
      } catch (error) {
        console.warn('[PlayTab] Failed to fetch ratings:', error);
      }
    };

    void fetchRatings();

    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  const prefetchKeyForTrack = useCallback((track: RateTrackInfo | PlaylistTrack | null | undefined): string | null => {
    if (!track || !track.sidPath) {
      return null;
    }
    const songPart = typeof track.selectedSong === 'number' ? track.selectedSong : 0;
    return `${track.sidPath}#${songPart}`;
  }, []);

  const prefetchTrackSession = useCallback(async (track: PlaylistTrack | null | undefined): Promise<void> => {
    if (!track) {
      return;
    }
    const key = prefetchKeyForTrack(track);
    if (!key) {
      return;
    }
    if (prefetchedSessionsRef.current.has(key)) {
      return;
    }
    const existing = prefetchPromisesRef.current.get(key);
    if (existing) {
      await existing.catch(() => undefined);
      return;
    }

    const job = (async () => {
      try {
        const response = await playManualTrack({ sid_path: track.sidPath });
        if (!response.success) {
          console.warn('[PlayTab] Prefetch failed:', formatApiError(response));
          return;
        }
        prefetchedSessionsRef.current.set(key, response.data);
      } catch (error) {
        console.error('[PlayTab] Prefetch error', error);
      } finally {
        prefetchPromisesRef.current.delete(key);
      }
    })();

    prefetchPromisesRef.current.set(key, job);
    await job.catch(() => undefined);
  }, [prefetchKeyForTrack]);

  const waitForPrefetch = useCallback(async (track: PlaylistTrack | null | undefined): Promise<void> => {
    if (!track) {
      return;
    }
    const key = prefetchKeyForTrack(track);
    if (!key) {
      return;
    }
    const pending = prefetchPromisesRef.current.get(key);
    if (!pending) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, PREFETCH_WAIT_MS);

      pending.finally(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }, [prefetchKeyForTrack]);

  const consumePrefetchedSession = useCallback(async (track: PlaylistTrack | null | undefined): Promise<RateTrackWithSession | null> => {
    if (!track) {
      return null;
    }
    const key = prefetchKeyForTrack(track);
    if (!key) {
      return null;
    }
    let payload = prefetchedSessionsRef.current.get(key) ?? null;
    if (payload) {
      prefetchedSessionsRef.current.delete(key);
      return payload;
    }

    await waitForPrefetch(track);
    payload = prefetchedSessionsRef.current.get(key) ?? null;
    if (payload) {
      prefetchedSessionsRef.current.delete(key);
    }
    return payload;
  }, [prefetchKeyForTrack, waitForPrefetch]);

  const assignPlaylistNumber = useCallback((track: RateTrackInfo): PlaylistTrack => {
    const existing = trackNumberMapRef.current.get(track.sidPath);
    if (existing) {
      return { ...track, playlistNumber: existing };
    }
    const playlistNumber = playlistCounterRef.current++;
    trackNumberMapRef.current.set(track.sidPath, playlistNumber);
    return { ...track, playlistNumber };
  }, []);

  const loadTrackIntoPlayer = useCallback(
    async (
      payload: RateTrackWithSession,
      playlistNumber: number,
      announcement?: string
    ): Promise<boolean> => {
      const player = playerRef.current;
      if (!player) {
        statusHandlerRef.current('Playback engine not ready', true);
        return false;
      }

      if (!payload.session) {
        statusHandlerRef.current('Playback session missing for requested SID', true);
        return false;
      }

      pendingLoadAbortRef.current?.abort();
      const abortController = new AbortController();
      pendingLoadAbortRef.current = abortController;
      isAudioLoadingRef.current = true;
      setIsAudioLoading(true);
      setIsPauseReady(false);
      recomputePauseReady('load-start');
      setLoadProgress(0);
      let playbackStarted = false;
      console.debug('[PlayTab] loadTrackIntoPlayer: starting load', {
        track: payload.track.sidPath,
        sessionId: payload.session.sessionId,
        playlistNumber,
      });

      try {
        await player.load({
          track: payload.track,
          session: payload.session,
          signal: abortController.signal,
        });
        console.debug('[PlayTab] loadTrackIntoPlayer: load resolved', {
          track: payload.track.sidPath,
          playerState: player.getState(),
        });

        const normalized: PlaylistTrack = {
          ...payload.track,
          playlistNumber,
        };
        trackNumberMapRef.current.set(normalized.sidPath, normalized.playlistNumber);
        setCurrentTrack(normalized);
        currentTrackRef.current = normalized;
        setIsPauseReady(true);
        recomputePauseReady('track-loaded');
        const resolvedDuration =
          player.getDurationSeconds() ||
          normalized.durationSeconds ||
          parseLengthSeconds(normalized.metadata.length);
        setDuration(resolvedDuration);
        setPosition(0);
        await player.play();
        console.debug('[PlayTab] loadTrackIntoPlayer: play resolved', {
          track: payload.track.sidPath,
          playerState: player.getState(),
        });
        playbackStarted = true;
        setIsPlaying(true);
        if (announcement) {
          statusHandlerRef.current(announcement);
        }
        void cacheTrack(payload.track, payload.session ?? null, maxCacheEntries);
        notifyTrackPlayed(normalized.sidPath);
        return true;
      } catch (error) {
        if (!abortController.signal.aborted) {
          statusHandlerRef.current(
            `Unable to load SID: ${error instanceof Error ? error.message : String(error)}`,
            true
          );
        }
        return false;
      } finally {
        if (pendingLoadAbortRef.current === abortController) {
          pendingLoadAbortRef.current = null;
        }
        isAudioLoadingRef.current = false;
        setIsAudioLoading(false);
        if (playbackStarted) {
          setIsPauseReady(true);
          recomputePauseReady('playback-start');
        } else {
          recomputePauseReady('load-complete');
        }
        console.debug('[PlayTab] loadTrackIntoPlayer: load finished', {
          trackAttempted: payload.track.sidPath,
          playbackStarted,
          playerState: player.getState(),
          isAudioLoading: isAudioLoadingRef.current,
        });
      }
    },
    [maxCacheEntries, notifyTrackPlayed, recomputePauseReady]
  );

  const rebuildPlaylist = useCallback(async () => {
    setIsLoading(true);
    try {
      pendingLoadAbortRef.current?.abort();
      playerRef.current?.stop();
      trackNumberMapRef.current.clear();
      playlistCounterRef.current = 1;
      playedRef.current = [];
      prefetchedSessionsRef.current.clear();
      prefetchPromisesRef.current.clear();
      setPlayedTracks([]);
      applyUpcoming([]);
      currentTrackRef.current = null;
      setCurrentTrack(null);
      isAudioLoadingRef.current = false;
      setIsAudioLoading(false);
      setIsPauseReady(false);
      recomputePauseReady('playlist-reset');
      setLoadProgress(0);
      setIsPlaying(false);
      setPosition(0);
      setDuration(180);

      const seeded: PlaylistTrack[] = [];
      const shouldPreferCache = preferOfflineCache || !isOnlineRef.current;
      if (shouldPreferCache) {
        const cached = await listCachedTracks(INITIAL_PLAYLIST_SIZE);
        for (const entry of cached) {
          const numbered = assignPlaylistNumber(entry.track);
          seeded.push(numbered);
          if (entry.session) {
            const key = prefetchKeyForTrack(entry.track);
            if (key) {
              prefetchedSessionsRef.current.set(key, {
                track: entry.track,
                session: entry.session,
              });
            }
          }
        }
        const queueFromCache = applyUpcoming(seeded);
        if (queueFromCache.length > 0 && isOnlineRef.current) {
          void prefetchTrackSession(queueFromCache[0]);
        }
        if (!isOnlineRef.current) {
          await enqueuePlaylistRebuild(preset);
          await refreshQueueCount();
          if (seeded.length === 0) {
            notifyStatus('Offline with no cached tracks available. Playlist rebuild queued.', true);
          } else {
            notifyStatus('Offline mode using cached playlist. Rebuild queued for when you reconnect.');
          }
          return;
        }
      }

      const initialSeedTarget = Math.min(2, INITIAL_PLAYLIST_SIZE);
      while (seeded.length < initialSeedTarget) {
        const response = await requestRandomPlayTrack(preset, { preview: true });
        if (!response.success) {
          notifyStatus(`Unable to seed playlist: ${formatApiError(response)}`, true);
          break;
        }
        const track = response.data.track;
        void cacheTrack(track, response.data.session ?? null, maxCacheEntries);
        const numbered = assignPlaylistNumber(track);
        seeded.push(numbered);
      }

      if (seeded.length === 0) {
        notifyStatus('No songs available for this preset.', true);
      }

      const queued = applyUpcoming(seeded);
      if (queued.length > 0) {
        void prefetchTrackSession(queued[0]);
      }

      if (queued.length > 0 && queued.length < INITIAL_PLAYLIST_SIZE) {
        void (async () => {
          for (let index = queued.length; index < INITIAL_PLAYLIST_SIZE; index += 1) {
            if (!isOnlineRef.current) {
              await enqueuePlaylistRebuild(preset);
              await refreshQueueCount();
              break;
            }
            const response = await requestRandomPlayTrack(preset, { preview: true });
            if (!response.success) {
              break;
            }
            const track = response.data.track;
            void cacheTrack(track, response.data.session ?? null, maxCacheEntries);
            const numbered = assignPlaylistNumber(track);
            updateUpcoming((queue) => [...queue, numbered]);
          }
        })();
      }
    } catch (error) {
      if (!isOnlineRef.current) {
        await enqueuePlaylistRebuild(preset);
        await refreshQueueCount();
        notifyStatus('Offline mode: playlist rebuild queued for when you reconnect.', true);
      } else {
        notifyStatus(
          `Unable to seed playlist: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyUpcoming, assignPlaylistNumber, isOnlineRef, maxCacheEntries, notifyStatus, preferOfflineCache, prefetchTrackSession, preset, recomputePauseReady, refreshQueueCount, updateUpcoming]);

  useEffect(() => {
    rebuildPlaylistRef.current = rebuildPlaylist;
  }, [rebuildPlaylist]);

  useEffect(() => {
    void rebuildPlaylist();
  }, [rebuildPlaylist]);

  const startPlayback = useCallback(
    async (track: PlaylistTrack, announcement?: string) => {
      setIsLoading(true);
      try {
        if (!isOnlineRef.current) {
          await enqueuePlayNext();
          await refreshQueueCount();
          notifyStatus('Offline. Track queued for playback when you reconnect.');
          return false;
        }
        let payload = await consumePrefetchedSession(track);

        if (!payload) {
          const response = await playManualTrack({ sid_path: track.sidPath });
          if (!response.success) {
            notifyStatus(`Unable to load SID: ${formatApiError(response)}`, true);
            return false;
          }
          payload = response.data;
        }

        const playlistNumber = track.playlistNumber;
        const success = await loadTrackIntoPlayer(payload, playlistNumber, announcement);
        if (!success) {
          const key = prefetchKeyForTrack(track);
          if (key) {
            prefetchedSessionsRef.current.set(key, payload);
          }
          return false;
        }
        return true;
      } finally {
        setIsLoading(false);
      }
    },
    [consumePrefetchedSession, loadTrackIntoPlayer, notifyStatus, prefetchKeyForTrack, refreshQueueCount]
  );

  const playNextFromQueue = useCallback(async () => {
    if (!isOnlineRef.current) {
      notifyStatus('Offline. Playback will resume when you reconnect.');
      await enqueuePlayNext();
      await refreshQueueCount();
      return;
    }
    if (isLoading || isAudioLoading) {
      return;
    }
    const queue = upcomingRef.current.slice();
    if (queue.length === 0) {
      notifyStatus('No upcoming songs. Change the preset to rebuild the playlist.', true);
      return;
    }
    const [nextTrack, ...rest] = queue;
    updateUpcoming(() => rest);
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
      updateUpcoming((current) => [nextTrack, ...current]);
    }
    if (upcomingRef.current.length > 0) {
      void prefetchTrackSession(upcomingRef.current[0]);
    }
  }, [isAudioLoading, isLoading, notifyStatus, prefetchTrackSession, refreshQueueCount, startPlayback, updateUpcoming]);

  useEffect(() => {
    if (!isOnline || queueProcessingRef.current) {
      return;
    }
    let cancelled = false;
    queueProcessingRef.current = true;
    const run = async () => {
      try {
        await flushPlaybackQueue(async (record) => {
          if (record.kind === 'rebuild-playlist') {
            const rebuild = rebuildPlaylistRef.current;
            if (rebuild) {
              await rebuild();
            }
          } else if (record.kind === 'play-next') {
            const handler = playNextHandlerRef.current;
            if (handler) {
              await handler();
            }
          }
        });
      } finally {
        queueProcessingRef.current = false;
        if (!cancelled) {
          await refreshQueueCount();
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isOnline, refreshQueueCount]);

  useEffect(() => {
    playNextHandlerRef.current = playNextFromQueue;
  }, [playNextFromQueue]);

  useEffect(() => {
    if (upcomingTracks.length > 0) {
      void prefetchTrackSession(upcomingTracks[0]);
    }
  }, [prefetchTrackSession, upcomingTracks]);

  const handlePlayPause = useCallback(async () => {
    const player = playerRef.current;
    if (!currentTrack || !player || isAudioLoading) {
      return;
    }
    const state = player.getState();
    if (state === 'playing') {
      player.pause();
      notifyStatus('Playback paused');
      return;
    }
    try {
      await player.play();
      notifyStatus('Playback resumed');
    } catch (error) {
      notifyStatus(
        `Unable to resume playback: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    }
  }, [currentTrack, isAudioLoading, notifyStatus]);

  const handlePreviousTrack = useCallback(async () => {
    if (playedRef.current.length === 0) {
      notifyStatus('No previously played songs', true);
      return;
    }
    const track = playedRef.current.shift()!;
    const current = currentTrackRef.current;
    if (current) {
      updateUpcoming((queue) => [current, ...queue]);
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
    if (upcomingRef.current.length > 0) {
      void prefetchTrackSession(upcomingRef.current[0]);
    }
  }, [notifyStatus, prefetchTrackSession, startPlayback, updateUpcoming]);

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
      if (upcomingRef.current.length > 0) {
        void prefetchTrackSession(upcomingRef.current[0]);
      }
    },
    [prefetchTrackSession, startPlayback]
  );

  const handleSeek = useCallback(
    (value: number[]) => {
      const player = playerRef.current;
      if (!currentTrack || !player) {
        return;
      }
      const next = Math.min(Math.max(0, value[0]), duration);
      setPosition(next);
      if (seekTimeout.current) {
        clearTimeout(seekTimeout.current);
      }
      seekTimeout.current = setTimeout(() => {
        player.seek(next);
      }, 180);
    },
    [currentTrack, duration]
  );

  const handleVolumeChange = useCallback(
    (value: number[]) => {
      const player = playerRef.current;
      const newVolume = Math.min(Math.max(0, value[0]), 1);
      setVolume(newVolume);
      if (player) {
        player.setVolume(newVolume);
      }
    },
    []
  );

  // Sync volume with player on mount
  useEffect(() => {
    const player = playerRef.current;
    if (player) {
      player.setVolume(volume);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlaySong = useCallback(
    async (sidPath: string) => {
      try {
        notifyStatus(`Loading: ${sidPath}`, false);
        const playlist = await buildSongPlaylist(sidPath);
        if (playlist.length === 0) {
          notifyStatus('No songs found', true);
          return;
        }

        // Clear existing queue and switch to song mode
        setPlaybackMode('song');
        setPlaybackModeDescription(playlist[0].displayName);

        // Load and play the song
        const response = await playManualTrack({ sid_path: sidPath });
        if (!response.success) {
          notifyStatus(`Failed to load track: ${formatApiError(response)}`, true);
          return;
        }

        const track = assignPlaylistNumber(response.data.track);
        await loadTrackIntoPlayer(response.data, track.playlistNumber, `Now playing: ${track.displayName}`);
      } catch (error) {
        notifyStatus(`Error playing song: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
    [notifyStatus, assignPlaylistNumber, loadTrackIntoPlayer]
  );

  const handlePlayFolder = useCallback(
    async (folderPath: string, recursive: boolean, shuffle: boolean) => {
      try {
        const modeDesc = getPlaylistModeDescription(folderPath, recursive, shuffle);
        notifyStatus(`Building playlist: ${modeDesc}`, false);

        const playlist = await buildFolderPlaylist(folderPath, { recursive, shuffle });
        if (playlist.length === 0) {
          notifyStatus('No songs found in folder', true);
          return;
        }

        // Switch to folder mode
        setPlaybackMode('folder');
        setPlaybackModeDescription(modeDesc);

        // Convert playlist items to PlaylistTrack format and queue them
        const tracks: PlaylistTrack[] = [];
        for (const item of playlist) {
          const response = await playManualTrack({ sid_path: item.sidPath });
          if (response.success) {
            const track = assignPlaylistNumber(response.data.track);
            tracks.push(track);
          }
        }

        if (tracks.length === 0) {
          notifyStatus('Failed to load any tracks', true);
          return;
        }

        // Set the first track and add rest to upcoming
        updateUpcoming(() => tracks.slice(1));

        // Load and play the first track
        const firstResponse = await playManualTrack({ sid_path: tracks[0].sidPath });
        if (!firstResponse.success) {
          notifyStatus(`Failed to load first track: ${formatApiError(firstResponse)}`, true);
          return;
        }

        await loadTrackIntoPlayer(
          firstResponse.data,
          tracks[0].playlistNumber,
          `Playing ${modeDesc} (${tracks.length} songs)`
        );
      } catch (error) {
        notifyStatus(`Error playing folder: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
    [notifyStatus, assignPlaylistNumber, loadTrackIntoPlayer, updateUpcoming, playManualTrack]
  );

  const handleStartStation = useCallback(
    async (sidPath: string) => {
      try {
        notifyStatus(`Creating station from "${currentTrack?.displayName}"...`, false);

        const response = await requestStationFromSong({
          sid_path: sidPath,
          limit: 20,
          similarity: stationSimilarity,
          discovery: stationDiscovery,
        });

        if (!response.success) {
          notifyStatus(`Failed to create station: ${formatApiError(response)}`, true);
          return;
        }

        const { similarTracks, stationName } = response.data;

        if (similarTracks.length === 0) {
          notifyStatus('No similar tracks found for this station', true);
          return;
        }

        // Switch to folder mode with station name
        setPlaybackMode('folder');
        setPlaybackModeDescription(stationName);

        // Convert similar tracks to PlaylistTrack format
        const tracks: PlaylistTrack[] = [];
        for (const track of similarTracks) {
          const numbered = assignPlaylistNumber(track);
          tracks.push(numbered);
        }

        // Queue all tracks
        updateUpcoming(() => tracks);

        notifyStatus(`Station ready with ${tracks.length} tracks. Press "Play Next Track" to start.`);
      } catch (error) {
        notifyStatus(`Error creating station: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
    [currentTrack, notifyStatus, assignPlaylistNumber, updateUpcoming, stationSimilarity, stationDiscovery]
  );

  const handleMoodTransition = useCallback(
    async () => {
      try {
        const startMood = PRESET_TO_EMC[transitionStart];
        const endMood = PRESET_TO_EMC[transitionEnd];

        notifyStatus(`Creating mood transition: ${PRESETS.find(p => p.value === transitionStart)?.label} → ${PRESETS.find(p => p.value === transitionEnd)?.label}...`, false);

        const response = await fetch('/api/play/mood-transition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_mood: startMood,
            end_mood: endMood,
            limit: 7,
          }),
        });

        const data = await response.json();

        if (!data.success) {
          notifyStatus(`Failed to create mood transition: ${data.error}`, true);
          return;
        }

        const { tracks: transitionTracks, stationName } = data.data;

        if (transitionTracks.length === 0) {
          notifyStatus('No tracks found for this mood transition', true);
          return;
        }

        // Switch to folder mode with transition name
        setPlaybackMode('folder');
        setPlaybackModeDescription(stationName);

        // Convert to PlaylistTrack format
        const tracks: PlaylistTrack[] = [];
        for (const track of transitionTracks) {
          const numbered = assignPlaylistNumber(track);
          tracks.push(numbered);
        }

        // Queue all tracks
        updateUpcoming(() => tracks);

        notifyStatus(`Mood transition ready with ${tracks.length} tracks. Press "Play Next Track" to start.`);
        setShowMoodTransition(false);
      } catch (error) {
        notifyStatus(`Error creating mood transition: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
    [transitionStart, transitionEnd, notifyStatus, assignPlaylistNumber, updateUpcoming]
  );

  const handleEraStation = useCallback(
    async () => {
      try {
        let yearStart: number;
        let yearEnd: number;
        let eraLabel: string;

        if (eraPreset === 'custom') {
          yearStart = customYearStart;
          yearEnd = customYearEnd;
          eraLabel = `${yearStart}-${yearEnd}`;
        } else {
          const preset = ERA_PRESETS[eraPreset];
          yearStart = preset.start;
          yearEnd = preset.end;
          eraLabel = preset.label;
        }

        notifyStatus(`Creating era station: ${eraLabel}...`, false);

        const response = await fetch('/api/play/era-station', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            yearStart,
            yearEnd,
            limit: 20,
          }),
        });

        const data = await response.json();

        if (!data.success) {
          notifyStatus(`Failed to create era station: ${data.error}`, true);
          return;
        }

        const { tracks: eraTracks, stationName } = data.data;

        if (eraTracks.length === 0) {
          notifyStatus(`No tracks found for era ${eraLabel}`, true);
          return;
        }

        // Switch to folder mode with era name
        setPlaybackMode('folder');
        setPlaybackModeDescription(stationName);

        // Convert to PlaylistTrack format
        const tracks: PlaylistTrack[] = [];
        for (const track of eraTracks) {
          const numbered = assignPlaylistNumber(track);
          tracks.push(numbered);
        }

        // Queue all tracks
        updateUpcoming(() => tracks);

        notifyStatus(`Era station ready with ${tracks.length} tracks. Press "Play Next Track" to start.`);
        setShowEraExplorer(false);
      } catch (error) {
        notifyStatus(`Error creating era station: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
    [eraPreset, customYearStart, customYearEnd, notifyStatus, assignPlaylistNumber, updateUpcoming]
  );

  const handleFindSimilarComposers = useCallback(
    async () => {
      if (!currentTrack || !currentTrack.metadata.author) {
        notifyStatus('No track playing or composer information missing', true);
        return;
      }

      try {
        notifyStatus(`Finding composers similar to ${currentTrack.metadata.author}...`, false);

        const response = await fetch('/api/play/similar-composers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            composer: currentTrack.metadata.author,
            limit: 5,
          }),
        });

        const data = await response.json();

        if (!data.success) {
          notifyStatus(`Failed to find similar composers: ${data.error}`, true);
          return;
        }

        setSimilarComposers(data.data.similar_composers);
        setShowComposerDiscovery(true);
        notifyStatus(`Found ${data.data.similar_composers.length} similar composers`);
      } catch (error) {
        notifyStatus(`Error finding similar composers: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
    [currentTrack, notifyStatus]
  );

  const handleFindHiddenGems = useCallback(
    async () => {
      try {
        setIsLoadingHiddenGems(true);
        notifyStatus('Finding hidden gems...', false);

        const response = await fetch('/api/play/hidden-gems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            limit: 20,
            minRating: 4.0,
          }),
        });

        const data = await response.json();

        if (!data.success) {
          notifyStatus(`Failed to find hidden gems: ${data.error}`, true);
          return;
        }

        const { tracks: gemTracks, stationName } = data.data;

        if (gemTracks.length === 0) {
          notifyStatus('No hidden gems found', true);
          return;
        }

        // Switch to folder mode with gems name
        setPlaybackMode('folder');
        setPlaybackModeDescription(stationName);

        // Convert to PlaylistTrack format
        const tracks: PlaylistTrack[] = [];
        for (const track of gemTracks) {
          const numbered = assignPlaylistNumber(track);
          tracks.push(numbered);
        }

        // Queue all tracks
        updateUpcoming(() => tracks);

        notifyStatus(`Hidden gems ready with ${tracks.length} tracks. Press "Play Next Track" to start.`);
      } catch (error) {
        notifyStatus(`Error finding hidden gems: ${error instanceof Error ? error.message : String(error)}`, true);
      } finally {
        setIsLoadingHiddenGems(false);
      }
    },
    [notifyStatus, assignPlaylistNumber, updateUpcoming]
  );

  const handleCreateChipStation = useCallback(
    async (chipModel: '6581' | '8580' | '8580r5') => {
      try {
        setIsLoadingChipStation(true);
        notifyStatus(`Creating ${chipModel} station...`, false);

        const response = await fetch('/api/play/chip-station', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chipModel,
            limit: 20,
          }),
        });

        const data = await response.json();

        if (!data.success) {
          notifyStatus(`Failed to create chip station: ${data.error}`, true);
          return;
        }

        const { tracks: chipTracks, stationName } = data.data;

        if (chipTracks.length === 0) {
          notifyStatus(`No tracks found for ${chipModel}`, true);
          return;
        }

        // Switch to folder mode with chip name
        setPlaybackMode('folder');
        setPlaybackModeDescription(stationName);

        // Convert to PlaylistTrack format
        const tracks: PlaylistTrack[] = [];
        for (const track of chipTracks) {
          const numbered = assignPlaylistNumber(track);
          tracks.push(numbered);
        }

        // Queue all tracks
        updateUpcoming(() => tracks);

        notifyStatus(`${stationName} ready with ${tracks.length} tracks. Press "Play Next Track" to start.`);
        setShowChipModelSelector(false);
      } catch (error) {
        notifyStatus(`Error creating chip station: ${error instanceof Error ? error.message : String(error)}`, true);
      } finally {
        setIsLoadingChipStation(false);
      }
    },
    [notifyStatus, assignPlaylistNumber, updateUpcoming]
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

        // Save to localStorage for personal rating display
        setPersonalRating(currentTrack.sidPath, value, { e: value, m: value, c: value, p: value });
        setPersonalRatingState({
          rating: value,
          timestamp: new Date().toISOString(),
          dimensions: { e: value, m: value, c: value, p: value },
        });

        recordExplicitRating({
          track: currentTrack,
          ratings: { e: value, m: value, c: value, p: value },
          sessionId: playerRef.current?.getSession()?.sessionId,
          pipeline: getPipelineKind(),
          metadata: {
            origin: 'play-tab',
            preset,
            control: label.toLowerCase(),
            advance,
          },
        });
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
    [currentTrack, getPipelineKind, isRating, notifyStatus, playNextFromQueue, preset]
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
      {hasHydrated && (!isOnline || pendingQueueCount > 0) && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          data-testid="playback-offline-banner"
          data-pending-count={pendingQueueCount}
        >
          <div className="flex items-start gap-3 text-sm text-amber-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1">
              {!isOnline ? (
                <p>
                  Offline mode: playback requests are queued locally and will resume once you're back online.
                </p>
              ) : (
                <p>Replaying queued playback actions…</p>
              )}
              {pendingQueueCount > 0 ? (
                <p
                  className="text-xs text-amber-700"
                  data-testid="playback-pending-actions"
                >
                  Pending actions: {pendingQueueCount}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
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
                onClick={() => {
                  recordImplicitForCurrent('skip', {
                    origin: 'play-tab',
                    control: 'play-next-button',
                    preset,
                  });
                  void playNextFromQueue();
                }}
                disabled={isLoading || isAudioLoading || upcomingTracks.length === 0}
                className="w-full retro-glow gap-2"
              >
                <Play className="h-4 w-4" />
                {upcomingTracks.length === 0 ? 'PLAYLIST EMPTY' : 'PLAY NEXT TRACK'}
              </Button>
              <Button
                onClick={() => setShowMoodTransition(!showMoodTransition)}
                variant="outline"
                className="w-full gap-2"
                title="Create smooth mood transition playlist"
              >
                <Forward className="h-4 w-4" />
                MOOD TRANSITION
              </Button>
              {showMoodTransition && (
                <div className="p-3 border border-border/60 rounded bg-muted/20 space-y-3">
                  <div className="text-sm font-semibold text-foreground">Mood Transition</div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">From</label>
                    <Select value={transitionStart} onValueChange={(value) => setTransitionStart(value as MoodPreset)}>
                      <SelectTrigger>
                        <SelectValue />
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
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">To</label>
                    <Select value={transitionEnd} onValueChange={(value) => setTransitionEnd(value as MoodPreset)}>
                      <SelectTrigger>
                        <SelectValue />
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
                    onClick={handleMoodTransition}
                    disabled={isLoading}
                    className="w-full gap-2"
                  >
                    <Play className="h-4 w-4" />
                    CREATE TRANSITION
                  </Button>
                </div>
              )}
              <Button
                onClick={() => setShowEraExplorer(!showEraExplorer)}
                variant="outline"
                className="w-full gap-2"
                title="Explore music from specific time periods"
              >
                <Music2 className="h-4 w-4" />
                ERA EXPLORER
              </Button>
              {showEraExplorer && (
                <div className="p-3 border border-border/60 rounded bg-muted/20 space-y-3">
                  <div className="text-sm font-semibold text-foreground">Era Explorer</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant={eraPreset === '1980s' ? 'default' : 'outline'}
                      onClick={() => setEraPreset('1980s')}
                    >
                      1980s
                    </Button>
                    <Button
                      size="sm"
                      variant={eraPreset === '1990s' ? 'default' : 'outline'}
                      onClick={() => setEraPreset('1990s')}
                    >
                      1990s
                    </Button>
                    <Button
                      size="sm"
                      variant={eraPreset === '2000s' ? 'default' : 'outline'}
                      onClick={() => setEraPreset('2000s')}
                    >
                      2000s
                    </Button>
                    <Button
                      size="sm"
                      variant={eraPreset === 'golden' ? 'default' : 'outline'}
                      onClick={() => setEraPreset('golden')}
                    >
                      Golden Age
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant={eraPreset === 'custom' ? 'default' : 'outline'}
                    onClick={() => setEraPreset('custom')}
                    className="w-full"
                  >
                    Custom Range
                  </Button>
                  {eraPreset === 'custom' && (
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center">
                        <input
                          type="number"
                          value={customYearStart}
                          onChange={(e) => setCustomYearStart(parseInt(e.target.value) || 1980)}
                          min={1980}
                          max={2030}
                          className="w-20 px-2 py-1 text-sm border rounded"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                          type="number"
                          value={customYearEnd}
                          onChange={(e) => setCustomYearEnd(parseInt(e.target.value) || 1992)}
                          min={1980}
                          max={2030}
                          className="w-20 px-2 py-1 text-sm border rounded"
                        />
                      </div>
                    </div>
                  )}
                  <Button
                    onClick={handleEraStation}
                    disabled={isLoading}
                    className="w-full gap-2"
                  >
                    <Play className="h-4 w-4" />
                    CREATE ERA STATION
                  </Button>
                </div>
              )}
              <Button
                onClick={handleFindHiddenGems}
                disabled={isLoading || isLoadingHiddenGems}
                variant="outline"
                className="w-full gap-2"
                title="Discover high-quality underplayed tracks"
              >
                <Star className="h-4 w-4" />
                {isLoadingHiddenGems ? 'FINDING GEMS...' : 'HIDDEN GEMS'}
              </Button>
              <Button
                onClick={() => setShowChipModelSelector(!showChipModelSelector)}
                variant="outline"
                className="w-full gap-2"
                title="Explore tracks by SID chip model"
              >
                <Settings className="h-4 w-4" />
                CHIP MODEL
              </Button>
              {showChipModelSelector && (
                <div className="p-3 border border-border/60 rounded bg-muted/20 space-y-3">
                  <div className="text-sm font-semibold text-foreground">Chip Model Station</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleCreateChipStation('6581')}
                      disabled={isLoadingChipStation}
                    >
                      6581
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleCreateChipStation('8580')}
                      disabled={isLoadingChipStation}
                    >
                      8580
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleCreateChipStation('8580r5')}
                      disabled={isLoadingChipStation}
                    >
                      8580R5
                    </Button>
                  </div>
                </div>
              )}
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
                disabled={!currentTrack || playedTracks.length === 0 || isLoading || isAudioLoading}
                title="Previous track"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePlayPause}
                disabled={!isPauseReady}
                aria-label="Pause playback / Resume playback"
                aria-pressed={isPlaying}
                title={isPlaying ? 'Pause playback' : 'Start playback'}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={playNextFromQueue}
                disabled={upcomingTracks.length === 0 || isLoading || isAudioLoading}
                title="Next track"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2 min-w-[140px]">
              {volume === 0 ? (
                <VolumeX className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <Volume2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <Slider
                value={[volume]}
                onValueChange={handleVolumeChange}
                min={0}
                max={1}
                step={0.01}
                className="cursor-pointer w-full"
                title={`Volume: ${Math.round(volume * 100)}%`}
                aria-label="Volume control"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(volume * 100)}
                aria-valuetext={`${Math.round(volume * 100)} percent`}
              />
            </div>
            <div className="flex-1 w-full">
              <Slider
                value={[position]}
                onValueChange={handleSeek}
                min={0}
                max={Math.max(duration, 1)}
                step={1}
                disabled={!currentTrack || isAudioLoading}
                className="cursor-pointer"
              />
              {isAudioLoading && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>
                    Loading audio
                    {loadProgress > 0 && loadProgress < 1
                      ? ` ${(loadProgress * 100).toFixed(0)}%`
                      : '…'}
                  </span>
                </div>
              )}
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

              {aggregateRating && (
                <div className="pt-2 border-t border-border/40 space-y-2">
                  {personalRating && (
                    <div className="flex items-center gap-2 pb-2">
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3 w-3 ${i < personalRating.rating
                                ? 'fill-blue-500 text-blue-500'
                                : 'text-muted-foreground'
                              }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs font-semibold text-blue-500">
                        You rated: {personalRating.rating}/5
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center gap-1"
                        title={`Energy: ${aggregateRating.community.dimensions.energy}/5 • Mood: ${aggregateRating.community.dimensions.mood}/5 • Complexity: ${aggregateRating.community.dimensions.complexity}/5`}
                      >
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-4 w-4 ${i < Math.round(aggregateRating.community.averageRating)
                                ? 'fill-yellow-500 text-yellow-500'
                                : 'text-muted-foreground'
                              }`}
                          />
                        ))}
                      </div>
                      <span className="text-sm font-semibold text-foreground">
                        {aggregateRating.community.averageRating.toFixed(1)}/5
                      </span>
                      {aggregateRating.community.totalRatings > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({aggregateRating.community.totalRatings} {aggregateRating.community.totalRatings === 1 ? 'rating' : 'ratings'})
                        </span>
                      )}
                    </div>
                    {aggregateRating.trending.isTrending && (
                      <div className="flex items-center gap-1 text-xs font-semibold text-orange-500">
                        <TrendingUp className="h-3 w-3" />
                        <span>Trending</span>
                      </div>
                    )}
                  </div>
                  {aggregateRating.community.totalRatings > 0 && (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div className="flex items-center gap-3">
                        <span>{aggregateRating.community.likes} likes</span>
                        <span>•</span>
                        <span>{aggregateRating.community.plays} plays</span>
                        {aggregateRating.trending.recentPlays > 0 && (
                          <>
                            <span>•</span>
                            <span>{aggregateRating.trending.recentPlays} recent</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isRating}
                  onClick={() => {
                    recordImplicitForCurrent('like', {
                      origin: 'play-tab',
                      control: 'quick-like',
                      preset,
                    });
                    void submitRating(5, 'Like', true);
                  }}
                >
                  <ThumbsUp className="h-4 w-4" /> Like
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isRating}
                  onClick={() => {
                    recordImplicitForCurrent('dislike', {
                      origin: 'play-tab',
                      control: 'quick-dislike',
                      preset,
                    });
                    void submitRating(1, 'Dislike', true);
                  }}
                >
                  <ThumbsDown className="h-4 w-4" /> Dislike
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isRating}
                  onClick={() => {
                    recordImplicitForCurrent('skip', {
                      origin: 'play-tab',
                      control: 'quick-skip',
                      preset,
                    });
                    void submitRating(3, 'Skipped', true);
                  }}
                >
                  <Forward className="h-4 w-4" /> Next
                </Button>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      void handleStartStation(currentTrack.sidPath);
                    }}
                    title="Create a personalized radio station based on this song"
                  >
                    <Radio className="h-4 w-4" /> Start Station
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShowStationSettings(!showStationSettings)}
                    title="Adjust station parameters"
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={handleFindSimilarComposers}
                  disabled={!currentTrack.metadata.author}
                  title="Find composers with similar musical styles"
                >
                  <Music2 className="h-4 w-4" /> Similar Composers
                </Button>
              </div>

              {showComposerDiscovery && similarComposers.length > 0 && (
                <div className="mt-3 p-3 border border-border/60 rounded bg-muted/20 space-y-2">
                  <div className="text-sm font-semibold text-foreground">
                    Composers Similar to {currentTrack.metadata.author}
                  </div>
                  <div className="space-y-1">
                    {similarComposers.map((similar, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground">{similar.composer}</span>
                        <span className="text-muted-foreground">
                          {(similar.similarity_score * 100).toFixed(0)}% similar
                        </span>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowComposerDiscovery(false)}
                    className="w-full mt-2"
                  >
                    Close
                  </Button>
                </div>
              )}

              {showStationSettings && (
                <div className="mt-3 p-3 border border-border/60 rounded bg-muted/20 space-y-3">
                  <div className="text-sm font-semibold text-foreground">Station Parameters</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Personalization</span>
                      <span className="font-semibold text-foreground">{Math.round(stationSimilarity * 100)}%</span>
                    </div>
                    <Slider
                      value={[stationSimilarity]}
                      onValueChange={(value) => setStationSimilarity(value[0])}
                      min={0}
                      max={1}
                      step={0.1}
                      className="cursor-pointer"
                      title="Higher = stronger personalization based on your feedback"
                    />
                    <p className="text-xs text-muted-foreground">
                      Higher values boost tracks you liked and penalize tracks you disliked
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Discovery</span>
                      <span className="font-semibold text-foreground">{Math.round(stationDiscovery * 100)}%</span>
                    </div>
                    <Slider
                      value={[stationDiscovery]}
                      onValueChange={(value) => setStationDiscovery(value[0])}
                      min={0}
                      max={1}
                      step={0.1}
                      className="cursor-pointer"
                      title="Higher = more exploration of different tracks"
                    />
                    <p className="text-xs text-muted-foreground">
                      Higher values include more diverse tracks, lower values keep it very similar
                    </p>
                  </div>
                </div>
              )}
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
              {playbackMode === 'mood' ? 'Fixed queue for this mood' : `Playing: ${playbackModeDescription}`}
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

      <SongBrowser
        onPlaySong={handlePlaySong}
        onPlayFolder={handlePlayFolder}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}
