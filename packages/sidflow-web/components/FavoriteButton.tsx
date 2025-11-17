'use client';

import { useCallback, useState } from 'react';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addFavorite, removeFavorite } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import { useFavorites } from '@/contexts/FavoritesContext';

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
  const { favorites, addToContext, removeFromContext } = useFavorites();
  const [isLoading, setIsLoading] = useState(false);
  
  const isFavorite = favorites.has(sidPath);

  const handleToggleFavorite = useCallback(async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      if (isFavorite) {
        // Remove from favorites
        const response = await removeFavorite(sidPath);
        if (response.success) {
          removeFromContext(sidPath);
          onFavoriteChange?.(false);
          onStatusChange?.('Removed from favorites');
        } else {
          onStatusChange?.(`Failed to remove favorite: ${formatApiError(response)}`, true);
        }
      } else {
        // Add to favorites
        const response = await addFavorite(sidPath);
        if (response.success) {
          addToContext(sidPath);
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
  }, [isFavorite, isLoading, sidPath, addToContext, removeFromContext, onFavoriteChange, onStatusChange]);

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
