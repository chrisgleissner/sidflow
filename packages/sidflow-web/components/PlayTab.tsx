'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  playManualTrack,
  controlRatePlayback,
  getRatePlaybackStatus,
  rateTrack,
  type RateTrackInfo,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import { getUpcomingSongs } from '@/lib/sid-metadata';
import {
  Play,
  Pause,
  Square,
  SkipForward,
  SkipBack,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

interface PlayTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
  onTrackPlayed: (sidPath: string) => void;
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.floor(seconds % 60));
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function PlayTab({ onStatusChange, onTrackPlayed }: PlayTabProps) {
  const [sidPath, setSidPath] = useState('');
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

  const handlePlay = useCallback(async () => {
    if (!sidPath.trim()) {
      onStatusChange('Enter a SID path to play', true);
      return;
    }

    setIsLoading(true);
    onStatusChange('Starting playback...');

    try {
      const response = await playManualTrack({ sid_path: sidPath });
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
      onStatusChange(`Playing ${track.displayName}`);
    } catch (error) {
      onStatusChange(`Failed to start playback: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      setIsLoading(false);
    }
  }, [sidPath, onStatusChange, onTrackPlayed, refreshStatus]);

  const handleTransport = useCallback(
    async (action: 'pause' | 'resume' | 'stop') => {
      const response = await controlRatePlayback({ action });
      if (response.success) {
        await refreshStatus();
        onStatusChange(action === 'stop' ? 'Playback stopped' : action === 'pause' ? 'Playback paused' : 'Playback resumed');
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

  const handleSkipForward = useCallback(async () => {
    const response = await controlRatePlayback({
      action: 'seek',
      positionSeconds: Math.min(duration, position + 10),
    });
    if (!response.success) {
      onStatusChange(`Seek failed: ${formatApiError(response)}`, true);
    } else {
      await refreshStatus();
    }
  }, [duration, position, onStatusChange, refreshStatus]);

  const handleQuickRate = useCallback(
    async (value: number) => {
      if (!currentTrack || isRating) {
        return;
      }
      setIsRating(true);
      try {
        const response = await rateTrack({
          sid_path: currentTrack.sidPath,
          ratings: { e: value, m: value, c: value, p: value },
        });
        if (response.success) {
          onStatusChange('Rating submitted');
        } else {
          onStatusChange(`Rating failed: ${formatApiError(response)}`, true);
        }
      } catch (error) {
        onStatusChange(`Failed to rate: ${error instanceof Error ? error.message : String(error)}`, true);
      } finally {
        setIsRating(false);
      }
    },
    [currentTrack, isRating, onStatusChange]
  );

  return (
    <div className="space-y-4">
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">PLAY SID MUSIC</CardTitle>
          <CardDescription className="text-muted-foreground">
            Enter any SID path within your HVSC mirror and take control.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label htmlFor="play-sid-path" className="text-xs font-semibold tracking-tight text-muted-foreground">
              SID PATH
            </label>
            <input
              id="play-sid-path"
              type="text"
              value={sidPath}
              onChange={(e) => setSidPath(e.target.value)}
              placeholder="/workspace/hvsc/C64Music/.../song.sid"
              className="w-full px-3 py-2 bg-input border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isLoading}
            />
          </div>
          <Button onClick={handlePlay} disabled={isLoading} className="w-full retro-glow">
            {isLoading ? 'STARTING...' : 'PLAY TRACK'}
          </Button>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">PLAYBACK</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="icon" onClick={() => handleTransport('stop')} disabled={!currentTrack}>
              <Square className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleTransport(isPlaying ? 'pause' : 'resume')}
              disabled={!currentTrack}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={handleRestart} disabled={!currentTrack}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleSkipForward} disabled={!currentTrack}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {currentTrack && (
        <Card className="c64-border">
          <CardHeader>
            <CardTitle className="text-sm petscii-text text-accent">NOW PLAYING</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="font-semibold text-foreground">{currentTrack.displayName}</p>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Artist</span>
                <p className="font-mono text-sm text-foreground">{currentTrack.metadata.author ?? 'Unknown'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Year</span>
                <p>{currentTrack.metadata.released ?? '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">SID Model</span>
                <p>{currentTrack.metadata.sidModel}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Length</span>
                <p>{currentTrack.metadata.length ?? '—'}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleQuickRate(5)} disabled={isRating}>
                <ThumbsUp className="h-4 w-4 mr-1" /> Like
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleQuickRate(1)} disabled={isRating}>
                <ThumbsDown className="h-4 w-4 mr-1" /> Dislike
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">NEXT UP</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {upcomingSongs.map((song, index) => (
            <div key={index} className="rounded border border-border/60 bg-muted/30 p-3 text-xs">
              <p className="font-semibold text-foreground">{song.title}</p>
              <p className="text-muted-foreground">{song.artist}</p>
              <p className="text-muted-foreground">{song.length}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
