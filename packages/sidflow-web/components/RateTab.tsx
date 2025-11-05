'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { rateTrack } from '@/lib/api-client';
import type { RateRequest } from '@/lib/validation';
import { Star, ThumbsUp, ThumbsDown } from 'lucide-react';

interface SidMetadata {
  title?: string;
  artist?: string;
  year?: string;
  length?: string;
  format?: string;
  songs?: number;
  sidModel?: string;
  clockSpeed?: string;
}

interface UpcomingSong {
  title: string;
  artist: string;
  year: string;
  length: string;
}

interface RateTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function RateTab({ onStatusChange }: RateTabProps) {
  const [sidPath, setSidPath] = useState('');
  const [energy, setEnergy] = useState([3]);
  const [mood, setMood] = useState([3]);
  const [complexity, setComplexity] = useState([3]);
  const [preference, setPreference] = useState([3]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidMetadata, setSidMetadata] = useState<SidMetadata | null>(null);
  const [upcomingSongs, setUpcomingSongs] = useState<UpcomingSong[]>([]);

  // Load metadata when path changes
  useEffect(() => {
    if (sidPath.trim()) {
      // Extract metadata from path (simulated)
      const filename = sidPath.split('/').pop() || sidPath;
      const parts = sidPath.split('/');
      const artist = parts.length >= 3 ? parts[parts.length - 2].replace(/_/g, ' ') : 'Unknown Artist';
      
      setSidMetadata({
        title: filename.replace('.sid', '').replace(/_/g, ' '),
        artist: artist,
        year: '1984',
        length: '3:00',
        format: 'PSID v2',
        songs: 3,
        sidModel: '6581',
        clockSpeed: 'PAL (50Hz)',
      });

      // Simulate upcoming songs
      setUpcomingSongs([
        {
          title: 'Arkanoid',
          artist: 'Martin Galway',
          year: '1987',
          length: '2:45',
        },
        {
          title: 'Thing on a Spring',
          artist: 'Rob Hubbard',
          year: '1985',
          length: '3:20',
        },
        {
          title: 'Wizball',
          artist: 'Martin Galway',
          year: '1987',
          length: '4:05',
        },
      ]);
    } else {
      setSidMetadata(null);
      setUpcomingSongs([]);
    }
  }, [sidPath]);

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

  const handleSubmit = async () => {
    if (!sidPath.trim()) {
      onStatusChange('Please enter a SID file path', true);
      return;
    }

    setIsLoading(true);
    onStatusChange('Submitting rating...');

    try {
      const request: RateRequest = {
        sid_path: sidPath,
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
        onStatusChange(`Error: ${response.error}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to submit rating: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">RATE TRACK</CardTitle>
          <CardDescription className="text-muted-foreground">
            Submit manual ratings for a SID track
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="rate-path" className="text-sm font-medium">
              SID FILE PATH
            </label>
            <input
              id="rate-path"
              type="text"
              value={sidPath}
              onChange={(e) => setSidPath(e.target.value)}
              placeholder="/path/to/music.sid"
              className="w-full px-3 py-2 bg-input border-2 border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isLoading}
            />
          </div>

          {/* SID Metadata */}
          {sidMetadata && (
            <div className="pt-3 border-t-2 border-border">
              <p className="text-sm font-medium mb-2">TRACK INFORMATION:</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Title:</span>
                  <span className="ml-2 font-bold">{sidMetadata.title}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Artist:</span>
                  <span className="ml-2 font-bold">{sidMetadata.artist}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Year:</span>
                  <span className="ml-2 font-bold">{sidMetadata.year}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Length:</span>
                  <span className="ml-2 font-bold">{sidMetadata.length}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Format:</span>
                  <span className="ml-2 font-bold">{sidMetadata.format}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">SID Model:</span>
                  <span className="ml-2 font-bold">{sidMetadata.sidModel}</span>
                </div>
              </div>
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
                  variant={energy[0] === rating ? "default" : "outline"}
                  onClick={() => setEnergy([rating])}
                  className="flex-1 gap-1"
                  disabled={isLoading}
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
                  variant={mood[0] === rating ? "default" : "outline"}
                  onClick={() => setMood([rating])}
                  className="flex-1 gap-1"
                  disabled={isLoading}
                >
                  <Star className={`h-3 w-3 ${mood[0] >= rating ? 'fill-current' : ''}`} />
                  {rating}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Dark/Melancholic • 5 = Bright/Cheerful
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
                  variant={complexity[0] === rating ? "default" : "outline"}
                  onClick={() => setComplexity([rating])}
                  className="flex-1 gap-1"
                  disabled={isLoading}
                >
                  <Star className={`h-3 w-3 ${complexity[0] >= rating ? 'fill-current' : ''}`} />
                  {rating}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Simple Patterns • 5 = Complex Arrangements
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
                  variant={preference[0] === rating ? "default" : "outline"}
                  onClick={() => setPreference([rating])}
                  className="flex-1 gap-1"
                  disabled={isLoading}
                >
                  <Star className={`h-3 w-3 ${preference[0] >= rating ? 'fill-current' : ''}`} />
                  {rating}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Not My Style • 5 = Love It!
            </p>
          </div>

          {/* Overall Like/Dislike */}
          <div className="flex justify-center gap-4 pt-2 border-t-2 border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLike}
              className="gap-2"
              disabled={isLoading}
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
              disabled={isLoading}
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
              <label className="text-sm font-medium">ENERGY</label>
              <span className="text-lg font-bold text-accent">{energy[0]}/5</span>
            </div>
            <Slider
              value={energy}
              onValueChange={setEnergy}
              min={1}
              max={5}
              step={1}
              disabled={isLoading}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              How energetic or intense is the track?
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">MOOD</label>
              <span className="text-lg font-bold text-accent">{mood[0]}/5</span>
            </div>
            <Slider
              value={mood}
              onValueChange={setMood}
              min={1}
              max={5}
              step={1}
              disabled={isLoading}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              1 = Dark/Somber, 5 = Bright/Upbeat
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">COMPLEXITY</label>
              <span className="text-lg font-bold text-accent">{complexity[0]}/5</span>
            </div>
            <Slider
              value={complexity}
              onValueChange={setComplexity}
              min={1}
              max={5}
              step={1}
              disabled={isLoading}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              How complex is the melody and structure?
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">PREFERENCE</label>
              <span className="text-lg font-bold text-accent">{preference[0]}/5</span>
            </div>
            <Slider
              value={preference}
              onValueChange={setPreference}
              min={1}
              max={5}
              step={1}
              disabled={isLoading}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              How much do you like this track personally?
            </p>
          </div>

          <Button 
            onClick={handleSubmit} 
            disabled={isLoading} 
            className="w-full retro-glow"
          >
            {isLoading ? 'SUBMITTING...' : 'SUBMIT RATING'}
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
