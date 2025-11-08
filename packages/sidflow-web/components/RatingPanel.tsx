'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { rateTrack } from '@/lib/api-client';
import type { RateRequest } from '@/lib/validation';
import { formatApiError } from '@/lib/format-error';

interface RatingPanelProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function RatingPanel({ onStatusChange }: RatingPanelProps) {
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
        onStatusChange(`Rating failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to submit rating: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate Track</CardTitle>
        <CardDescription>
          Submit manual ratings for a SID track
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="rate-path" className="text-sm font-medium">
            SID File Path
          </label>
          <input
            id="rate-path"
            type="text"
            value={sidPath}
            onChange={(e) => setSidPath(e.target.value)}
            placeholder="/path/to/music.sid"
            className="w-full px-3 py-2 border rounded-md"
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Energy: {energy[0]}
          </label>
          <Slider
            value={energy}
            onValueChange={setEnergy}
            min={1}
            max={5}
            step={1}
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Mood: {mood[0]}
          </label>
          <Slider
            value={mood}
            onValueChange={setMood}
            min={1}
            max={5}
            step={1}
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Complexity: {complexity[0]}
          </label>
          <Slider
            value={complexity}
            onValueChange={setComplexity}
            min={1}
            max={5}
            step={1}
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Preference: {preference[0]}
          </label>
          <Slider
            value={preference}
            onValueChange={setPreference}
            min={1}
            max={5}
            step={1}
            disabled={isLoading}
          />
        </div>

        <Button onClick={handleSubmit} disabled={isLoading} className="w-full">
          {isLoading ? 'Submitting...' : 'Submit Rating'}
        </Button>
      </CardContent>
    </Card>
  );
}
