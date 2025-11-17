'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getFavorites } from '@/lib/api-client';

interface FavoritesContextType {
  favorites: Set<string>;
  isLoading: boolean;
  refetch: () => Promise<void>;
  addToContext: (sidPath: string) => void;
  removeFromContext: (sidPath: string) => void;
}

const FavoritesContext = createContext<FavoritesContextType | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const fetchFavorites = useCallback(async () => {
    setIsLoading(false);
    try {
      const response = await getFavorites();
      if (response.success) {
        setFavorites(new Set(response.data.favorites));
      }
    } catch (error) {
      console.error('Failed to load favorites:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFavorites();
  }, [fetchFavorites]);

  const addToContext = useCallback((sidPath: string) => {
    setFavorites(prev => new Set([...prev, sidPath]));
  }, []);

  const removeFromContext = useCallback((sidPath: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(sidPath);
      return next;
    });
  }, []);

  return (
    <FavoritesContext.Provider value={{ favorites, isLoading, refetch: fetchFavorites, addToContext, removeFromContext }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
}
