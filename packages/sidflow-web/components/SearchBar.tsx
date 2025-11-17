'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { searchTracks, type SearchResult } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface SearchBarProps {
  onPlayTrack?: (sidPath: string) => void;
  onStatusChange?: (status: string, isError?: boolean) => void;
  searchInputRef?: React.MutableRefObject<HTMLInputElement | null>;
}

export function SearchBar({ onPlayTrack, onStatusChange, searchInputRef }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement>(null);

  // Close results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await searchTracks(searchQuery.trim(), 20);
      if (response.success) {
        setResults(response.data.results);
        setShowResults(true);
        
        if (response.data.results.length === 0) {
          onStatusChange?.(`No results found for "${searchQuery}"`, false);
        }
      } else {
        onStatusChange?.(`Search failed: ${formatApiError(response)}`, true);
        setResults([]);
      }
    } catch (error) {
      onStatusChange?.(
        `Search error: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [onStatusChange]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    if (value.trim().length > 0) {
      debounceTimerRef.current = setTimeout(() => {
        void performSearch(value);
      }, 300);
    } else {
      setResults([]);
      setShowResults(false);
    }
  }, [performSearch]);

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  const handlePlayResult = useCallback((sidPath: string, displayName: string) => {
    onPlayTrack?.(sidPath);
    onStatusChange?.(`Playing: ${displayName}`, false);
    setShowResults(false);
  }, [onPlayTrack, onStatusChange]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Expose the input ref to parent if provided
  useEffect(() => {
    if (searchInputRef && internalInputRef.current) {
      searchInputRef.current = internalInputRef.current;
    }
  }, [searchInputRef]);

  return (
    <div className="relative w-full" ref={searchBoxRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={internalInputRef}
          type="text"
          placeholder="Search by title or artist..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => {
            if (results.length > 0) {
              setShowResults(true);
            }
          }}
          className="pl-10 pr-20"
          aria-label="Search for SID tracks"
          data-testid="search-input"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isSearching && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleClearSearch}
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <Card className="absolute top-full mt-2 w-full z-50 max-h-96 overflow-y-auto shadow-lg">
          <CardContent className="p-2">
            <div className="space-y-1">
              {results.map((result) => (
                <div
                  key={result.sidPath}
                  className="flex items-center justify-between rounded p-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{result.displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">{result.artist}</p>
                    <p className="text-xs text-muted-foreground/75 truncate">{result.sidPath}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={() => handlePlayResult(result.sidPath, result.displayName)}
                    title="Play this track"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
