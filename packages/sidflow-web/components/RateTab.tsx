'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { rateTrack } from '@/lib/api-client';
import type { RateRequest } from '@/lib/validation';

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
        // Reset form
        setSidPath('');
        setEnergy([3]);
        setMood([3]);
        setComplexity([3]);
        setPreference([3]);
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
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">RATING DIMENSIONS</CardTitle>
          <CardDescription className="text-muted-foreground">
            Rate from 1 (low) to 5 (high)
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
