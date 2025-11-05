'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { playTrack, rateTrack } from '@/lib/api-client';
import type { PlayRequest } from '@/lib/validation';
import { 
  Play, Pause, Square, SkipForward, SkipBack, 
  FastForward, Rewind, ThumbsUp, ThumbsDown,
  Star
} from 'lucide-react';

const MOOD_PRESETS = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'dark', label: 'Dark' },
  { value: 'bright', label: 'Bright' },
  { value: 'complex', label: 'Complex' },
] as const;

interface SidMetadata {
  title?: string;
  artist?: string;
  year?: string;
  length?: string;
  format?: string;
  version?: string;
  songs?: number;
  startSong?: number;
  sidModel?: string;
  clockSpeed?: string;
}

interface UpcomingSong {
  title: string;
  artist: string;
  year: string;
  length: string;
}

interface PlayTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
  onTrackPlayed: (sidPath: string) => void;
}

export function PlayTab({ onStatusChange, onTrackPlayed }: PlayTabProps) {
  const [sidPath, setSidPath] = useState('');
  const [preset, setPreset] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState([0]);
  const [duration, setDuration] = useState(180); // 3 minutes default
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [sidMetadata, setSidMetadata] = useState<SidMetadata | null>(null);
  const [upcomingSongs, setUpcomingSongs] = useState<UpcomingSong[]>([]);
  
  // Ratings state
  const [energy, setEnergy] = useState([3]);
  const [mood, setMood] = useState([3]);
  const [complexity, setComplexity] = useState([3]);
  const [preference, setPreference] = useState([3]);

  // Simulate playback progress
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setPosition(prev => {
          const newPos = prev[0] + 1;
          if (newPos >= duration) {
            setIsPlaying(false);
            return [0];
          }
          return [newPos];
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only handle if not typing in an input
      if (e.target instanceof HTMLInputElement) return;

      switch(e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;
        case 's':
          handleStop();
          break;
        case 'n':
          handleNext();
          break;
        case 'p':
          handlePrevious();
          break;
        case 'l':
          handleLike();
          break;
        case 'd':
          handleDislike();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isPlaying, sidPath]);

  const handlePlay = async () => {
    if (!sidPath.trim()) {
      onStatusChange('Please enter a SID file path', true);
      return;
    }

    setIsLoading(true);
    onStatusChange('Starting playback...');

    try {
      const request: PlayRequest = {
        sid_path: sidPath,
        ...(preset && { preset: preset as any }),
      };

      const response = await playTrack(request);

      if (response.success) {
        onStatusChange('Playback started successfully');
        onTrackPlayed(sidPath);
        setIsPlaying(true);
        setPosition([0]);
        
        // Extract metadata from path (simulated)
        const filename = sidPath.split('/').pop() || sidPath;
        const parts = sidPath.split('/');
        const artist = parts.length >= 3 ? parts[parts.length - 2].replace(/_/g, ' ') : 'Unknown Artist';
        
        setCurrentTrack({
          path: sidPath,
          filename,
          preset,
        });

        // Simulate SID metadata (in real implementation, this would parse the .sid file)
        setSidMetadata({
          title: filename.replace('.sid', '').replace(/_/g, ' '),
          artist: artist,
          year: '1984',
          length: formatTime(duration),
          format: 'PSID v2',
          version: '2',
          songs: 3,
          startSong: 1,
          sidModel: '6581',
          clockSpeed: 'PAL (50Hz)',
        });

        // Simulate upcoming songs
        setUpcomingSongs([
          {
            title: 'Last Ninja 2',
            artist: 'Matt Gray',
            year: '1988',
            length: '3:45',
          },
          {
            title: 'International Karate',
            artist: 'Rob Hubbard',
            year: '1986',
            length: '2:30',
          },
          {
            title: 'Monty on the Run',
            artist: 'Rob Hubbard',
            year: '1985',
            length: '4:12',
          },
        ]);
      } else {
        onStatusChange(`Error: ${response.error}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to start playback: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      onStatusChange('Playback paused');
    } else if (currentTrack) {
      setIsPlaying(true);
      onStatusChange('Playback resumed');
    } else {
      handlePlay();
    }
  };

  const handleStop = () => {
    setIsPlaying(false);
    setPosition([0]);
    onStatusChange('Playback stopped');
  };

  const handleNext = () => {
    onStatusChange('Next track (not implemented in API)');
  };

  const handlePrevious = () => {
    onStatusChange('Previous track (not implemented in API)');
  };

  const handleFastForward = () => {
    setPosition(prev => [Math.min(prev[0] + 10, duration)]);
  };

  const handleRewind = () => {
    setPosition(prev => [Math.max(prev[0] - 10, 0)]);
  };

  const handleLike = async () => {
    if (!currentTrack) return;
    await handleQuickRate(5, 5, preference[0], 5);
  };

  const handleDislike = async () => {
    if (!currentTrack) return;
    await handleQuickRate(1, 1, preference[0], 1);
  };

  const handleQuickRate = async (e: number, m: number, c: number, p: number) => {
    if (!currentTrack) return;

    try {
      const response = await rateTrack({
        sid_path: currentTrack.path,
        ratings: { e, m, c, p },
      });

      if (response.success) {
        onStatusChange('Rating submitted');
      }
    } catch (error) {
      onStatusChange(`Failed to rate: ${error}`, true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      {/* Track Selection */}
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">PLAY SID MUSIC</CardTitle>
          <CardDescription className="text-muted-foreground">
            Play a SID file with optional mood preset
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="sid-path" className="text-sm font-medium">
              SID FILE PATH
            </label>
            <input
              id="sid-path"
              type="text"
              value={sidPath}
              onChange={(e) => setSidPath(e.target.value)}
              placeholder="/path/to/music.sid"
              className="w-full px-3 py-2 bg-input border-2 border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isLoading || isPlaying}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="mood-preset" className="text-sm font-medium">
              MOOD PRESET (OPTIONAL)
            </label>
            <Select value={preset} onValueChange={setPreset} disabled={isLoading || isPlaying}>
              <SelectTrigger id="mood-preset">
                <SelectValue placeholder="Select mood preset" />
              </SelectTrigger>
              <SelectContent>
                {MOOD_PRESETS.map((mood) => (
                  <SelectItem key={mood.value} value={mood.value}>
                    {mood.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Current Track Info */}
      {currentTrack && (
        <>
          <Card className="c64-border">
            <CardHeader>
              <CardTitle className="petscii-text text-accent">NOW PLAYING</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* SID Metadata */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Title:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.title || currentTrack.filename}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Artist:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.artist || 'Unknown'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Year:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.year || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Length:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.length || formatTime(duration)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Format:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.format || 'PSID'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Songs:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.songs || '1'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">SID Model:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.sidModel || '6581'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Clock:</span>
                    <span className="ml-2 font-bold">{sidMetadata?.clockSpeed || 'PAL'}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                  {currentTrack.path}
                </p>
                {currentTrack.preset && (
                  <p className="text-sm text-accent">Preset: {currentTrack.preset.toUpperCase()}</p>
                )}
              </div>

              {/* Playback Position */}
              <div className="space-y-2">
                <Slider
                  value={position}
                  onValueChange={setPosition}
                  min={0}
                  max={duration}
                  step={1}
                  className="cursor-pointer"
                />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{formatTime(position[0])}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Playback Controls */}
              <div className="flex justify-center items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleRewind}
                  disabled={!isPlaying}
                  title="Rewind 10s (←)"
                >
                  <Rewind className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handlePrevious}
                  title="Previous (P)"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  className="h-12 w-12 retro-glow"
                  onClick={handlePlayPause}
                  disabled={isLoading}
                  title="Play/Pause (Space)"
                >
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleStop}
                  title="Stop (S)"
                >
                  <Square className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleNext}
                  title="Next (N)"
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleFastForward}
                  disabled={!isPlaying}
                  title="Fast Forward 10s (→)"
                >
                  <FastForward className="h-4 w-4" />
                </Button>
              </div>

              {/* Quick Rating Buttons */}
              <div className="space-y-3 pt-4 border-t-2 border-border">
                <p className="text-sm font-medium">QUICK RATING:</p>
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <Button
                      key={rating}
                      size="sm"
                      variant={preference[0] === rating ? "default" : "outline"}
                      onClick={() => handleQuickRate(rating, rating, rating, rating)}
                      className="gap-1"
                      title={`Rate ${rating} stars`}
                    >
                      <Star className={`h-4 w-4 ${preference[0] >= rating ? 'fill-current' : ''}`} />
                      {rating}
                    </Button>
                  ))}
                </div>
                <div className="flex justify-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLike}
                    className="gap-2"
                    title="Like (L)"
                  >
                    <ThumbsUp className="h-4 w-4" />
                    LIKE
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDislike}
                    className="gap-2"
                    title="Dislike (D)"
                  >
                    <ThumbsDown className="h-4 w-4" />
                    DISLIKE
                  </Button>
                </div>
              </div>

              {/* Detailed Ratings */}
              <div className="space-y-3 pt-4 border-t-2 border-border">
                <p className="text-sm font-medium">CURRENT RATINGS:</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Energy:</span>
                    <span className="ml-2 font-bold text-accent">{energy[0]}/5</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mood:</span>
                    <span className="ml-2 font-bold text-accent">{mood[0]}/5</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Complexity:</span>
                    <span className="ml-2 font-bold text-accent">{complexity[0]}/5</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Preference:</span>
                    <span className="ml-2 font-bold text-accent">{preference[0]}/5</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Upcoming Songs */}
          <Card className="c64-border">
            <CardHeader>
              <CardTitle className="text-sm petscii-text text-accent">UPCOMING SONGS</CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingSongs.length > 0 ? (
                <div className="space-y-2">
                  {upcomingSongs.map((song, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded border border-border">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Title:</span>
                          <span className="ml-2 font-bold">{song.title}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Artist:</span>
                          <span className="ml-2">{song.artist}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Year:</span>
                          <span className="ml-2">{song.year}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Length:</span>
                          <span className="ml-2">{song.length}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No upcoming songs in queue
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Keyboard Shortcuts */}
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">KEYBOARD SHORTCUTS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><kbd className="px-2 py-1 bg-muted rounded">SPACE</kbd> Play/Pause</div>
            <div><kbd className="px-2 py-1 bg-muted rounded">S</kbd> Stop</div>
            <div><kbd className="px-2 py-1 bg-muted rounded">N</kbd> Next</div>
            <div><kbd className="px-2 py-1 bg-muted rounded">P</kbd> Previous</div>
            <div><kbd className="px-2 py-1 bg-muted rounded">L</kbd> Like</div>
            <div><kbd className="px-2 py-1 bg-muted rounded">D</kbd> Dislike</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
