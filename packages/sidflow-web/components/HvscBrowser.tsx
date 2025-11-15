'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Folder, Music, ChevronRight, Home, Play, List, Shuffle } from 'lucide-react';
import type { HvscBrowseItem, HvscBrowseResponse } from '@/app/api/hvsc/browse/route';

export interface HvscBrowserProps {
  onPlaySong?: (sidPath: string) => void;
  onPlayFolder?: (folderPath: string, recursive: boolean, shuffle: boolean) => void;
  onStatusChange?: (status: string, isError?: boolean) => void;
}

interface BreadcrumbSegment {
  name: string;
  path: string;
}

export function HvscBrowser({ onPlaySong, onPlayFolder, onStatusChange }: HvscBrowserProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<HvscBrowseItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPath = useCallback(
    async (path: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (path) {
          params.set('path', path);
        }
        const response = await fetch(`/api/hvsc/browse?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data: HvscBrowseResponse = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Browse failed');
        }
        setItems(data.items);
        setCurrentPath(data.path);
        onStatusChange?.(`Browsing: ${data.path || 'HVSC Root'}`, false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        onStatusChange?.(message, true);
      } finally {
        setIsLoading(false);
      }
    },
    [onStatusChange]
  );

  useEffect(() => {
    void fetchPath('');
  }, [fetchPath]);

  const navigateToPath = useCallback(
    (path: string) => {
      void fetchPath(path);
    },
    [fetchPath]
  );

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return;
    }
    parts.pop();
    navigateToPath(parts.join('/'));
  }, [currentPath, navigateToPath]);

  const navigateToRoot = useCallback(() => {
    navigateToPath('');
  }, [navigateToPath]);

  const handlePlaySong = useCallback(
    (item: HvscBrowseItem) => {
      if (item.type === 'file') {
        onPlaySong?.(item.path);
      }
    },
    [onPlaySong]
  );

  const handlePlayFolder = useCallback(
    (folderPath: string, recursive: boolean, shuffle: boolean) => {
      onPlayFolder?.(folderPath, recursive, shuffle);
    },
    [onPlayFolder]
  );

  const breadcrumbs: BreadcrumbSegment[] = [
    { name: 'HVSC', path: '' },
    ...currentPath
      .split('/')
      .filter(Boolean)
      .map((segment, idx, arr) => ({
        name: segment,
        path: arr.slice(0, idx + 1).join('/'),
      })),
  ];

  const folders = items.filter((item) => item.type === 'folder');
  const files = items.filter((item) => item.type === 'file');

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">HVSC COLLECTION BROWSER</CardTitle>
        <CardDescription className="text-muted-foreground">
          Navigate folders and play SID files from the High Voltage SID Collection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-1 text-sm flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={navigateToRoot}
            disabled={isLoading || currentPath === ''}
            className="gap-1 h-7 px-2"
          >
            <Home className="h-3 w-3" />
          </Button>
          {breadcrumbs.map((segment, idx) => (
            <div key={segment.path} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <Button
                variant={idx === breadcrumbs.length - 1 ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => idx < breadcrumbs.length - 1 && navigateToPath(segment.path)}
                disabled={isLoading || idx === breadcrumbs.length - 1}
                className="h-7 px-2 font-mono text-xs"
              >
                {segment.name}
              </Button>
            </div>
          ))}
        </div>

        {/* Parent Directory Navigation */}
        {currentPath && (
          <Button
            variant="outline"
            size="sm"
            onClick={navigateUp}
            disabled={isLoading}
            className="gap-2 w-full"
          >
            <Folder className="h-4 w-4" />
            <span>.. (Parent Directory)</span>
          </Button>
        )}

        {/* Error Display */}
        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Loading...
          </div>
        )}

        {/* Folders List */}
        {!isLoading && folders.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Folders ({folders.length})
            </h3>
            <div className="space-y-1">
              {folders.map((folder) => (
                <div
                  key={folder.path}
                  className="rounded border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2 p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigateToPath(folder.path)}
                      className="flex-1 justify-start gap-2 h-auto py-1 px-2"
                      disabled={isLoading}
                    >
                      <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{folder.name}</span>
                    </Button>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handlePlayFolder(folder.path, false, false)}
                        title="Play all songs in this folder"
                        disabled={!onPlayFolder}
                      >
                        <List className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handlePlayFolder(folder.path, true, false)}
                        title="Play all songs in this folder and subfolders"
                        disabled={!onPlayFolder}
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handlePlayFolder(folder.path, true, true)}
                        title="Shuffle all songs in this folder and subfolders"
                        disabled={!onPlayFolder}
                      >
                        <Shuffle className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Files List */}
        {!isLoading && files.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              SID Files ({files.length})
            </h3>
            <div className="space-y-1">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="rounded border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2 p-2">
                    <Music className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {file.songs ? `${file.songs} song${file.songs !== 1 ? 's' : ''}` : '1 song'}
                        {file.size ? ` • ${(file.size / 1024).toFixed(1)} KB` : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={() => handlePlaySong(file)}
                      title={`Play ${file.name}`}
                      disabled={!onPlaySong}
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && items.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            This folder is empty
          </div>
        )}
      </CardContent>
    </Card>
  );
}
