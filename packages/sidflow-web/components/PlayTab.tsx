'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  playManualTrack,
  rateTrack,
  requestRandomPlayTrack,
  type RateTrackInfo,
  type RateTrackWithSession,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import { SidflowPlayer, type SidflowPlayerState } from '@/lib/player/sidflow-player';
import { Play, Pause, SkipForward, SkipBack, ThumbsUp, ThumbsDown, Forward, Music2, Loader2, AlertTriangle, Volume2, VolumeX } from 'lucide-react';
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
import { FavoriteButton } from '@/components/FavoriteButton';
import { addToPlaybackHistory, getRecentHistory, clearPlaybackHistory, type PlaybackHistoryEntry } from '@/lib/playback-history';
import { SearchBar } from '@/components/SearchBar';

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
  const [historyVersion, setHistoryVersion] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [playbackMode, setPlaybackMode] = useState<'mood' | 'folder' | 'song'>('mood');
  const [playbackModeDescription, setPlaybackModeDescription] = useState<string>('Mood Station');
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

  // Memoize recently played history to avoid re-fetching on every render
  const recentHistory = useMemo(() => getRecentHistory(20), [historyVersion]);

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
        
        // Add to playback history
        addToPlaybackHistory({
          sidPath: normalized.sidPath,
          displayName: normalized.displayName,
          metadata: {
            author: normalized.metadata.author,
            released: normalized.metadata.released,
            length: normalized.metadata.length,
          },
        });
        
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
        recordExplicitRating({
          track: currentTrack,
          ratings: { e: value, m: value, c: value },
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
      
      {/* Search Bar */}
      <div className="mb-4">
        <SearchBar 
          onPlayTrack={handlePlaySong}
          onStatusChange={notifyStatus}
        />
      </div>
      
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
              <div className="flex flex-wrap gap-2 pt-2">
                <FavoriteButton
                  sidPath={currentTrack.sidPath}
                  size="sm"
                  variant="outline"
                  showLabel
                  onStatusChange={notifyStatus}
                />
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

      <Card className="c64-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm petscii-text text-accent">Recently Played</CardTitle>
              <CardDescription className="text-muted-foreground">
                Last 20 tracks from all sessions
              </CardDescription>
            </div>
            {hasHydrated && recentHistory.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm('Clear all playback history?')) {
                    clearPlaybackHistory();
                    setHistoryVersion(v => v + 1);
                    notifyStatus('Playback history cleared');
                  }
                }}
                className="text-xs"
              >
                Clear History
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!hasHydrated ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : recentHistory.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent playback history</p>
          ) : (
            <div className="space-y-2">
              {recentHistory.map((entry) => (
                <div
                  key={`${entry.sidPath}-${entry.timestamp}`}
                  className="flex items-center justify-between rounded border border-border/50 px-2 py-1 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">
                      {entry.displayName}
                    </p>
                    <p className="text-muted-foreground truncate">
                      {entry.metadata?.author ?? '—'} • {new Date(entry.timestamp).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => handlePlaySong(entry.sidPath)}
                    title="Play this song"
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SongBrowser
        onPlaySong={handlePlaySong}
        onPlayFolder={handlePlayFolder}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}
