'use client';

import { useState, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { rateTrack, requestRandomRateTrack, type RateTrackInfo } from '@/lib/api-client';
import { getUpcomingSongs, type SidMetadata, type UpcomingSong } from '@/lib/sid-metadata';
import type { RateRequest } from '@/lib/validation';
import { Shuffle, Music2, FileAudio2, Star, ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatApiError } from '@/lib/format-error';

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

function toSidMetadata(track: RateTrackInfo): SidMetadata {
  return {
    title: track.metadata.title ?? track.displayName,
    artist: track.metadata.author ?? 'Unknown Artist',
    year: track.metadata.released ?? 'Unknown',
    length: track.metadata.length ?? 'Unknown',
    format: track.metadata.sidType,
    version: String(track.metadata.version),
    songs: track.metadata.songs,
    startSong: track.metadata.startSong,
    sidModel: track.metadata.sidModel,
    clockSpeed: track.metadata.clock,
  };
}

export function RateTab({ onStatusChange }: RateTabProps) {
  const [currentTrack, setCurrentTrack] = useState<RateTrackInfo | null>(null);
  const [sidMetadata, setSidMetadata] = useState<SidMetadata | null>(null);
  const [upcomingSongs, setUpcomingSongs] = useState<UpcomingSong[]>([]);
  const [isFetchingTrack, setIsFetchingTrack] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [energy, setEnergy] = useState([3]);
  const [mood, setMood] = useState([3]);
  const [complexity, setComplexity] = useState([3]);
  const [preference, setPreference] = useState([3]);
  const energyLabelId = useId();
  const energyValueId = useId();
  const moodLabelId = useId();
  const moodValueId = useId();
  const complexityLabelId = useId();
  const complexityValueId = useId();
  const preferenceLabelId = useId();
  const preferenceValueId = useId();

  const handleLike = () => {
    setEnergy([5]);
    setMood([5]);
    setComplexity([5]);
    setPreference([5]);
  };

  const handleDislike = () => {
    setEnergy([1]);
    setMood([1]);
    setComplexity([1]);
    setPreference([1]);
  };

  const handlePlayRandom = async () => {
    setIsFetchingTrack(true);
    onStatusChange('Selecting a random SID and starting playback...');

    try {
      const response = await requestRandomRateTrack();
      if (!response.success) {
        onStatusChange(`Unable to start playback: ${formatApiError(response)}`, true);
        setIsFetchingTrack(false);
        return;
      }

      const track = response.data.track;
      setCurrentTrack(track);
      setSidMetadata(toSidMetadata(track));
      setUpcomingSongs(getUpcomingSongs());
      onStatusChange(
        `Now playing "${track.displayName}" (song ${track.selectedSong}/${track.metadata.songs})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Failed to start playback: ${message}`, true);
    } finally {
      setIsFetchingTrack(false);
    }
  };

  const handleSubmit = async () => {
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
          e: energy[0],
          m: mood[0],
          c: complexity[0],
          p: preference[0],
        },
      };

      const response = await rateTrack(request);

      if (response.success) {
        onStatusChange('Rating submitted successfully');
      } else {
        onStatusChange(`Rating failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to submit rating: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasTrack = Boolean(currentTrack);

  return (
    <div className="space-y-4">
      <Card className="c64-border">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="petscii-text text-accent">RATE TRACK</CardTitle>
              <CardDescription className="text-muted-foreground">
                Let SIDFlow pick an unrated SID, play it, then capture your feedback
              </CardDescription>
            </div>
            <Button
              onClick={handlePlayRandom}
              disabled={isFetchingTrack || isSubmitting}
              className="w-full md:w-auto retro-glow gap-2"
            >
              {isFetchingTrack ? (
                <>
                  <Music2 className="h-4 w-4 animate-spin" />
                  Finding SID...
                </>
              ) : (
                <>
                  <Shuffle className="h-4 w-4" />
                  Play Random SID
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentTrack ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="rounded bg-muted px-2 py-1 text-muted-foreground">
                  Song {currentTrack.selectedSong}/{currentTrack.metadata.songs}
                </span>
                <span className="rounded bg-muted px-2 py-1 text-muted-foreground">
                  {currentTrack.metadata.sidType} v{currentTrack.metadata.version}
                </span>
                <span className="text-muted-foreground">{currentTrack.relativePath}</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="font-semibold text-foreground">{sidMetadata?.title}</div>
                <div className="text-muted-foreground">
                  {sidMetadata?.artist} • {sidMetadata?.year}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                <div className="rounded border border-border/70 bg-muted/20 p-2">
                  <p className="text-muted-foreground">File Path</p>
                  <code className="block break-all text-foreground">{currentTrack.sidPath}</code>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 p-2">
                  <p className="text-muted-foreground">Length</p>
                  <p className="font-semibold text-foreground">
                    {sidMetadata?.length ?? 'Unknown'}
                  </p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 p-2">
                  <p className="text-muted-foreground">SID Model</p>
                  <p className="font-semibold text-foreground">
                    {currentTrack.metadata.sidModel}
                    {currentTrack.metadata.sidModelSecondary
                      ? ` + ${currentTrack.metadata.sidModelSecondary}`
                      : ''}
                  </p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 p-2">
                  <p className="text-muted-foreground">Clock</p>
                  <p className="font-semibold text-foreground">
                    {currentTrack.metadata.clock}
                  </p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 p-2">
                  <p className="text-muted-foreground">File Size</p>
                  <p className="font-semibold text-foreground">
                    {formatBytes(currentTrack.metadata.fileSizeBytes)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              <FileAudio2 className="h-4 w-4" />
              Press "Play Random SID" to load the next unrated track from your HVSC mirror.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Rating Buttons for Each Dimension */}
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">QUICK RATING BUTTONS</CardTitle>
          <CardDescription className="text-muted-foreground text-xs">
            Click to quickly set ratings for each dimension
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Energy Quick Rating */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">ENERGY</label>
              <span className="text-lg font-bold text-accent">{energy[0]}/5</span>
            </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <Button
                    key={rating}
                    size="sm"
                    variant={energy[0] === rating ? 'default' : 'outline'}
                    onClick={() => setEnergy([rating])}
                    className="flex-1 gap-1"
                    disabled={isSubmitting || !hasTrack}
                  >
                    <Star className={`h-3 w-3 ${energy[0] >= rating ? 'fill-current' : ''}`} />
                    {rating}
                  </Button>
                ))}
              </div>
            <p className="text-xs text-muted-foreground">
              1 = Quiet/Ambient • 5 = High-energy/Intense
            </p>
          </div>

          {/* Mood Quick Rating */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">MOOD</label>
              <span className="text-lg font-bold text-accent">{mood[0]}/5</span>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((rating) => (
                <Button
                  key={rating}
                  size="sm"
                  variant={mood[0] === rating ? 'default' : 'outline'}
                  onClick={() => setMood([rating])}
                  className="flex-1 gap-1"
                  disabled={isSubmitting || !hasTrack}
                >
                  <Star className={`h-3 w-3 ${mood[0] >= rating ? 'fill-current' : ''}`} />
                  {rating}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Dark/Somber • 5 = Bright/Upbeat
            </p>
          </div>

          {/* Complexity Quick Rating */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">COMPLEXITY</label>
              <span className="text-lg font-bold text-accent">{complexity[0]}/5</span>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((rating) => (
                <Button
                  key={rating}
                  size="sm"
                  variant={complexity[0] === rating ? 'default' : 'outline'}
                  onClick={() => setComplexity([rating])}
                  className="flex-1 gap-1"
                  disabled={isSubmitting || !hasTrack}
                >
                  <Star className={`h-3 w-3 ${complexity[0] >= rating ? 'fill-current' : ''}`} />
                  {rating}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Simple Grooves • 5 = Dense Arrangements
            </p>
          </div>

          {/* Preference Quick Rating */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">PREFERENCE</label>
              <span className="text-lg font-bold text-accent">{preference[0]}/5</span>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((rating) => (
                <Button
                  key={rating}
                  size="sm"
                  variant={preference[0] === rating ? 'default' : 'outline'}
                  onClick={() => setPreference([rating])}
                  className="flex-1 gap-1"
                  disabled={isSubmitting || !hasTrack}
                >
                  <Star className={`h-3 w-3 ${preference[0] >= rating ? 'fill-current' : ''}`} />
                  {rating}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Not my style • 5 = Instant favorite
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLike}
              className="gap-2"
              disabled={isSubmitting || !hasTrack}
              title="Set all ratings to 5"
            >
              <ThumbsUp className="h-4 w-4" />
              LIKE ALL
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
              DISLIKE ALL
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Sliders */}
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">FINE-TUNE WITH SLIDERS</CardTitle>
          <CardDescription className="text-muted-foreground">
            Adjust ratings precisely with sliders
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label id={energyLabelId} className="text-sm font-medium">
                ENERGY
              </label>
              <span
                id={energyValueId}
                data-testid="energy-value"
                className="text-lg font-bold text-accent"
              >
                {energy[0]}/5
              </span>
            </div>
            <Slider
              aria-labelledby={energyLabelId}
              aria-describedby={energyValueId}
              value={energy}
              onValueChange={setEnergy}
              min={1}
              max={5}
              step={1}
              disabled={isSubmitting || !hasTrack}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              How energetic or intense is the track?
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label id={moodLabelId} className="text-sm font-medium">
                MOOD
              </label>
              <span
                id={moodValueId}
                data-testid="mood-value"
                className="text-lg font-bold text-accent"
              >
                {mood[0]}/5
              </span>
            </div>
            <Slider
              aria-labelledby={moodLabelId}
              aria-describedby={moodValueId}
              value={mood}
              onValueChange={setMood}
              min={1}
              max={5}
              step={1}
              disabled={isSubmitting || !hasTrack}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              1 = Dark/Somber, 5 = Bright/Upbeat
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label id={complexityLabelId} className="text-sm font-medium">
                COMPLEXITY
              </label>
              <span
                id={complexityValueId}
                data-testid="complexity-value"
                className="text-lg font-bold text-accent"
              >
                {complexity[0]}/5
              </span>
            </div>
            <Slider
              aria-labelledby={complexityLabelId}
              aria-describedby={complexityValueId}
              value={complexity}
              onValueChange={setComplexity}
              min={1}
              max={5}
              step={1}
              disabled={isSubmitting || !hasTrack}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              How complex is the melody and structure?
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label id={preferenceLabelId} className="text-sm font-medium">
                PREFERENCE
              </label>
              <span
                id={preferenceValueId}
                data-testid="preference-value"
                className="text-lg font-bold text-accent"
              >
                {preference[0]}/5
              </span>
            </div>
            <Slider
              aria-labelledby={preferenceLabelId}
              aria-describedby={preferenceValueId}
              value={preference}
              onValueChange={setPreference}
              min={1}
              max={5}
              step={1}
              disabled={isSubmitting || !hasTrack}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              How much do you like this track personally?
            </p>
          </div>

          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting || !hasTrack} 
            className="w-full retro-glow"
          >
            {isSubmitting ? 'SUBMITTING...' : 'SUBMIT RATING'}
          </Button>
        </CardContent>
      </Card>

      {/* Upcoming Songs */}
      {upcomingSongs.length > 0 && (
        <Card className="c64-border">
          <CardHeader>
            <CardTitle className="text-sm petscii-text text-accent">UPCOMING SONGS TO RATE</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {/* Rating Guide */}
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">RATING GUIDE</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="font-bold text-accent">ENERGY</p>
              <p className="text-muted-foreground">1: Quiet, ambient</p>
              <p className="text-muted-foreground">5: High-energy, intense</p>
            </div>
            <div className="space-y-1">
              <p className="font-bold text-accent">MOOD</p>
              <p className="text-muted-foreground">1: Dark, melancholic</p>
              <p className="text-muted-foreground">5: Bright, cheerful</p>
            </div>
            <div className="space-y-1">
              <p className="font-bold text-accent">COMPLEXITY</p>
              <p className="text-muted-foreground">1: Simple patterns</p>
              <p className="text-muted-foreground">5: Complex arrangements</p>
            </div>
            <div className="space-y-1">
              <p className="font-bold text-accent">PREFERENCE</p>
              <p className="text-muted-foreground">1: Not my style</p>
              <p className="text-muted-foreground">5: Love it!</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
