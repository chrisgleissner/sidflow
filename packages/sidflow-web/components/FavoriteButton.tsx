'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addFavorite, removeFavorite, getFavorites } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface FavoriteButtonProps {
  sidPath: string;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  variant?: 'default' | 'outline' | 'ghost';
  showLabel?: boolean;
  onStatusChange?: (message: string, isError?: boolean) => void;
  onFavoriteChange?: (isFavorite: boolean) => void;
}

export function FavoriteButton({
  sidPath,
  size = 'icon',
  variant = 'ghost',
  showLabel = false,
  onStatusChange,
  onFavoriteChange,
}: FavoriteButtonProps) {
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Load initial favorite state
  useEffect(() => {
    let mounted = true;
    
    const loadFavoriteState = async () => {
      try {
        const response = await getFavorites();
        if (response.success && mounted) {
          const favorites = response.data.favorites;
          setIsFavorite(favorites.includes(sidPath));
        }
      } catch (error) {
        // Silently fail for initial load
        console.error('Failed to load favorite state:', error);
      }
    };
    
    void loadFavoriteState();
    
    return () => {
      mounted = false;
    };
  }, [sidPath]);

  const handleToggleFavorite = useCallback(async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      if (isFavorite) {
        // Remove from favorites
        const response = await removeFavorite(sidPath);
        if (response.success) {
          setIsFavorite(false);
          onFavoriteChange?.(false);
          onStatusChange?.('Removed from favorites');
        } else {
          onStatusChange?.(`Failed to remove favorite: ${formatApiError(response)}`, true);
        }
      } else {
        // Add to favorites
        const response = await addFavorite(sidPath);
        if (response.success) {
          setIsFavorite(true);
          onFavoriteChange?.(true);
          onStatusChange?.('Added to favorites');
        } else {
          onStatusChange?.(`Failed to add favorite: ${formatApiError(response)}`, true);
        }
      }
    } catch (error) {
      onStatusChange?.(
        `Error updating favorites: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      setIsLoading(false);
    }
  }, [isFavorite, isLoading, sidPath, onFavoriteChange, onStatusChange]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleToggleFavorite}
      disabled={isLoading}
      className={isFavorite ? 'text-red-500 hover:text-red-600' : ''}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={isFavorite}
    >
      <Heart 
        className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`}
        data-testid="favorite-icon"
      />
      {showLabel && (
        <span className="ml-2">
          {isFavorite ? 'Favorited' : 'Favorite'}
        </span>
      )}
    </Button>
  );
}
