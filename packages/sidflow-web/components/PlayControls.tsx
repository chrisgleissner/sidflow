'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { playTrack } from '@/lib/api-client';
import type { PlayRequest } from '@/lib/validation';
import { formatApiError } from '@/lib/format-error';

const MOOD_PRESETS = [
  { value: 'quiet', label: 'Quiet - Low energy, calm mood' },
  { value: 'ambient', label: 'Ambient - Moderate energy, neutral' },
  { value: 'energetic', label: 'Energetic - High energy, upbeat' },
  { value: 'dark', label: 'Dark - Moderate energy, somber' },
  { value: 'bright', label: 'Bright - High energy, upbeat' },
  { value: 'complex', label: 'Complex - High complexity focus' },
] as const;

interface PlayControlsProps {
  onStatusChange: (status: string, isError?: boolean) => void;
  onTrackPlayed: (sidPath: string) => void;
}

export function PlayControls({ onStatusChange, onTrackPlayed }: PlayControlsProps) {
  const [sidPath, setSidPath] = useState('');
  const [preset, setPreset] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

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
      } else {
        onStatusChange(`Playback failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to start playback: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Play SID Music</CardTitle>
        <CardDescription>
          Play a SID file with optional mood preset
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="sid-path" className="text-sm font-medium">
            SID File Path
          </label>
          <input
            id="sid-path"
            type="text"
            value={sidPath}
            onChange={(e) => setSidPath(e.target.value)}
            placeholder="/path/to/music.sid"
            className="w-full px-3 py-2 border rounded-md"
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="mood-preset" className="text-sm font-medium">
            Mood Preset (optional)
          </label>
          <Select value={preset} onValueChange={setPreset} disabled={isLoading}>
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

        <Button onClick={handlePlay} disabled={isLoading} className="w-full">
          {isLoading ? 'Playing...' : 'Play'}
        </Button>
      </CardContent>
    </Card>
  );
}
