'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchHvsc } from '@/lib/api-client';

interface FetchTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function FetchTab({ onStatusChange }: FetchTabProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleFetch = async () => {
    setIsLoading(true);
    onStatusChange('Fetching HVSC collection...');

    try {
      const response = await fetchHvsc();

      if (response.success) {
        onStatusChange('HVSC fetch completed successfully');
      } else {
        onStatusChange(`Error: ${response.error}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to fetch HVSC: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">FETCH HVSC</CardTitle>
        <CardDescription className="text-muted-foreground">
          Download or update the High Voltage SID Collection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm">
            This will synchronize your local HVSC mirror with the latest version from the remote repository.
          </p>
          <p className="text-sm text-muted-foreground">
            Note: This may take several minutes on first run.
          </p>
        </div>

        <Button 
          onClick={handleFetch} 
          disabled={isLoading} 
          className="w-full retro-glow"
          variant="default"
        >
          {isLoading ? 'FETCHING...' : 'START FETCH'}
        </Button>
      </CardContent>
    </Card>
  );
}
