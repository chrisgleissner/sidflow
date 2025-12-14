'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Play, TrendingUp, Loader2 } from 'lucide-react';
import { getCharts, type ChartEntry } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface TopChartsTabProps {
  onPlayTrack?: (sidPath: string) => void;
  onStatusChange?: (status: string, isError?: boolean) => void;
}

type TimeRange = 'week' | 'month' | 'all';

export function TopChartsTab({ onPlayTrack, onStatusChange }: TopChartsTabProps) {
  const [charts, setCharts] = useState<ChartEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('week');

  useEffect(() => {
    const loadCharts = async () => {
      setIsLoading(true);
      try {
        const response = await getCharts(timeRange, 20);
        if (response.success) {
          setCharts(response.data.charts);
        } else {
          onStatusChange?.(response.error || 'Failed to load charts', true);
        }
      } catch (error) {
        const errorMsg = formatApiError(error);
        onStatusChange?.(errorMsg, true);
      } finally {
        setIsLoading(false);
      }
    };

    void loadCharts();
  }, [timeRange, onStatusChange]);

  const handlePlay = (sidPath: string, displayName: string) => {
    onPlayTrack?.(sidPath);
    onStatusChange?.(`Playing: ${displayName}`);
  };

  const handleRangeChange = (range: TimeRange) => {
    setTimeRange(range);
    onStatusChange?.(`Loading ${range === 'all' ? 'all-time' : `this ${range}'s`} charts...`);
  };

  const getRangeLabel = (range: TimeRange): string => {
    switch (range) {
      case 'week':
        return 'This Week';
      case 'month':
        return 'This Month';
      case 'all':
        return 'All Time';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Top Charts</h2>
        </div>
        
        <div className="flex gap-2">
          {(['week', 'month', 'all'] as TimeRange[]).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleRangeChange(range)}
              disabled={isLoading}
            >
              {getRangeLabel(range)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading charts...</span>
        </div>
      ) : charts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No play data available for this time range.</p>
            <p className="text-sm mt-2">
              Charts are derived from server-side feedback logs under <code>data/feedback</code> (if present).
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {charts.map((entry, index) => (
            <Card key={entry.sidPath} className="hover:bg-accent transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Rank */}
                  <div className="flex-shrink-0 w-8 text-center">
                    <span className={`text-2xl font-bold ${
                      index === 0 ? 'text-yellow-500' :
                      index === 1 ? 'text-gray-400' :
                      index === 2 ? 'text-amber-600' :
                      'text-muted-foreground'
                    }`}>
                      {index + 1}
                    </span>
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{entry.displayName}</div>
                    <div className="text-sm text-muted-foreground truncate">{entry.artist}</div>
                  </div>

                  {/* Play Count */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-medium">{entry.playCount}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.playCount === 1 ? 'play' : 'plays'}
                    </div>
                  </div>

                  {/* Play Button */}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handlePlay(entry.sidPath, entry.displayName)}
                    title={`Play ${entry.displayName}`}
                    aria-label={`Play ${entry.displayName}`}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
