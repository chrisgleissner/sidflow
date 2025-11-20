'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Heart, Play, Shuffle, Trash2, Music2, Loader2 } from 'lucide-react';
import { getFavorites, removeFavorite, playManualTrack, type RateTrackWithSession } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface FavoritesTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
  onPlayTrack?: (session: RateTrackWithSession) => void;
  isActive?: boolean;
}

interface FavoriteTrack {
  sidPath: string;
  displayName: string;
  isLoading?: boolean;
}

export function FavoritesTab({ onStatusChange, onPlayTrack, isActive = false }: FavoritesTabProps) {
  const [favorites, setFavorites] = useState<FavoriteTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const wasActiveRef = useRef<boolean>(isActive);

  const loadFavorites = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getFavorites();
      if (response.success) {
        const tracks = response.data.favorites.map(sidPath => ({
          sidPath,
          displayName: sidPath.split('/').pop()?.replace('.sid', '') || sidPath,
        }));
        setFavorites(tracks);
        if (tracks.length === 0) {
          onStatusChange('No favorites yet. Add songs using the heart icon while playing.', false);
        }
      } else {
        onStatusChange(`Failed to load favorites: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(
        `Error loading favorites: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      setIsLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      void loadFavorites();
    }
    wasActiveRef.current = isActive;
  }, [isActive, loadFavorites]);

  const handleRemoveFavorite = useCallback(async (sidPath: string) => {
    try {
      const response = await removeFavorite(sidPath);
      if (response.success) {
        setFavorites(prev => prev.filter(f => f.sidPath !== sidPath));
        onStatusChange('Removed from favorites');
      } else {
        onStatusChange(`Failed to remove favorite: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(
        `Error removing favorite: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    }
  }, [onStatusChange]);

  const handlePlayTrack = useCallback(async (sidPath: string) => {
    try {
      setFavorites(prev => prev.map(f => 
        f.sidPath === sidPath ? { ...f, isLoading: true } : f
      ));
      
      const response = await playManualTrack({ sid_path: sidPath });
      if (response.success) {
        onPlayTrack?.(response.data);
        onStatusChange(`Playing: ${sidPath}`);
      } else {
        onStatusChange(`Failed to play track: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(
        `Error playing track: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      setFavorites(prev => prev.map(f => 
        f.sidPath === sidPath ? { ...f, isLoading: false } : f
      ));
    }
  }, [onPlayTrack, onStatusChange]);

  const shuffleArray = useCallback(<T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, []);

  const handlePlayAll = useCallback(async (shuffle: boolean = false) => {
    if (favorites.length === 0) {
      onStatusChange('No favorites to play', true);
      return;
    }

    setIsPlayingAll(true);
    try {
      const tracksToPlay = shuffle ? shuffleArray(favorites) : favorites;

      // For now, just play the first track
      // TODO: Implement queue system for playing all
      await handlePlayTrack(tracksToPlay[0].sidPath);
      onStatusChange(
        `Playing ${shuffle ? 'shuffled ' : ''}favorites (${favorites.length} tracks)`,
        false
      );
    } catch (error) {
      onStatusChange(
        `Error playing favorites: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      setIsPlayingAll(false);
    }
  }, [favorites, handlePlayTrack, onStatusChange, shuffleArray]);

  const handleClearAll = useCallback(async () => {
    if (!confirm(`Remove all ${favorites.length} favorites?`)) {
      return;
    }

    try {
      await Promise.all(favorites.map(favorite => removeFavorite(favorite.sidPath)));
      setFavorites([]);
      onStatusChange('Cleared all favorites');
    } catch (error) {
      onStatusChange(
        `Error clearing favorites: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
      void loadFavorites(); // Reload to sync state
    }
  }, [favorites, loadFavorites, onStatusChange]);

  return (
    <div className="space-y-4">
      <Card className="c64-border">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="petscii-text text-accent flex items-center gap-2">
                <Heart className="h-5 w-5 fill-current text-red-500" />
                FAVORITES
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {favorites.length} favorite {favorites.length === 1 ? 'track' : 'tracks'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => handlePlayAll(false)}
                disabled={isLoading || favorites.length === 0 || isPlayingAll}
                variant="default"
                size="sm"
                className="gap-2"
              >
                <Play className="h-4 w-4" />
                Play All
              </Button>
              <Button
                onClick={() => handlePlayAll(true)}
                disabled={isLoading || favorites.length === 0 || isPlayingAll}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Shuffle className="h-4 w-4" />
                Shuffle
              </Button>
              {favorites.length > 0 && (
                <Button
                  onClick={handleClearAll}
                  disabled={isLoading}
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear All
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading favorites...</span>
            </div>
          ) : favorites.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <Heart className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <p className="text-muted-foreground">No favorites yet</p>
              <p className="text-sm text-muted-foreground/75">
                Add songs using the heart icon while playing
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {favorites.map((favorite) => (
                <div
                  key={favorite.sidPath}
                  className="flex items-center justify-between rounded border border-border/50 px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Music2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">
                        {favorite.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {favorite.sidPath}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => handlePlayTrack(favorite.sidPath)}
                      disabled={favorite.isLoading}
                      title="Play this track"
                    >
                      {favorite.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleRemoveFavorite(favorite.sidPath)}
                      title="Remove from favorites"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
