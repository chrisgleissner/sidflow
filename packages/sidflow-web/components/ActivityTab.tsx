'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw, Loader2, Play, Heart, SkipForward } from 'lucide-react';

interface ActivityEvent {
    username: string;
    sidPath: string;
    action: 'play' | 'like' | 'skip';
    timestamp: string;
}

interface ActivityTabProps {
    onStatusChange?: (status: string, isError?: boolean) => void;
}

export function ActivityTab({ onStatusChange }: ActivityTabProps) {
    const [events, setEvents] = useState<ActivityEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadActivity = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/activity?limit=50');
            const data = await response.json();

            if (data.success) {
                setEvents(data.data.events);
                onStatusChange?.(`Loaded ${data.data.count} activities`, false);
            } else {
                setError(data.error || 'Failed to load activity');
                onStatusChange?.(data.error || 'Failed to load activity', true);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Network error';
            setError(message);
            onStatusChange?.(message, true);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadActivity();
    }, []);

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'play':
                return <Play className="h-4 w-4 text-green-500" />;
            case 'like':
                return <Heart className="h-4 w-4 text-red-500" />;
            case 'skip':
                return <SkipForward className="h-4 w-4 text-yellow-500" />;
            default:
                return <Activity className="h-4 w-4" />;
        }
    };

    const formatTimestamp = (timestamp: string) => {
        try {
            const date = new Date(timestamp);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);

            if (diffMins < 1) return 'just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return `${diffHours}h ago`;
            const diffDays = Math.floor(diffHours / 24);
            return `${diffDays}d ago`;
        } catch {
            return 'recently';
        }
    };

    const getSidName = (sidPath: string) => {
        const parts = sidPath.split('/');
        return parts[parts.length - 1]?.replace('.sid', '') || sidPath;
    };

    return (
        <Card className="c64-border">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        <CardTitle>ACTIVITY STREAM</CardTitle>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={loadActivity}
                        disabled={isLoading}
                        aria-label="Refresh activity"
                        data-testid="activity-refresh-button"
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                    </Button>
                </div>
                <CardDescription>
                    Recent listening activity from the community
                </CardDescription>
            </CardHeader>
            <CardContent>
                {error && (
                    <div className="text-center py-8 text-destructive">
                        <p>{error}</p>
                    </div>
                )}

                {!error && events.length === 0 && !isLoading && (
                    <div className="text-center py-8 text-muted-foreground">
                        <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No activity yet</p>
                    </div>
                )}

                {!error && events.length > 0 && (
                    <ScrollArea className="h-[600px]">
                        <div className="space-y-2">
                            {events.map((event, index) => (
                                <div
                                    key={`${event.timestamp}-${index}`}
                                    className="flex items-center gap-3 p-3 bg-accent/20 rounded hover:bg-accent/30 transition-colors"
                                >
                                    <div>{getActionIcon(event.action)}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm">
                                                {event.username}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {event.action === 'play' && 'played'}
                                                {event.action === 'like' && 'liked'}
                                                {event.action === 'skip' && 'skipped'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {getSidName(event.sidPath)}
                                        </p>
                                    </div>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        {formatTimestamp(event.timestamp)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
}
