'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface QueueItem {
  path: string;
  timestamp: number;
}

interface QueueViewProps {
  queue: QueueItem[];
}

export function QueueView({ queue }: QueueViewProps) {
  if (queue.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recently Played</CardTitle>
          <CardDescription>Your playback history will appear here</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tracks played yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recently Played</CardTitle>
        <CardDescription>{queue.length} track{queue.length !== 1 ? 's' : ''} played</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {queue.map((item, index) => (
            <div
              key={item.timestamp}
              className="flex items-center justify-between p-3 rounded-md border"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.path.split('/').pop()}</p>
                <p className="text-xs text-muted-foreground truncate">{item.path}</p>
              </div>
              <span className="text-xs text-muted-foreground ml-2">
                {new Date(item.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
