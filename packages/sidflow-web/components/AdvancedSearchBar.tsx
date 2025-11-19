'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, Loader2, Play, ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { searchTracks, type SearchResult, type SearchFilters } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface AdvancedSearchBarProps {
  onPlayTrack?: (sidPath: string) => void;
  onStatusChange?: (status: string, isError?: boolean) => void;
  onSurpriseMe?: () => void;
  searchInputRef?: React.MutableRefObject<HTMLInputElement | null>;
}

export function AdvancedSearchBar({ 
  onPlayTrack, 
  onStatusChange, 
  onSurpriseMe,
  searchInputRef 
}: AdvancedSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement>(null);

  // Filter state
  const [filters, setFilters] = useState<SearchFilters>({});
  const [yearRange, setYearRange] = useState<{ min?: string; max?: string }>({});
  const [durationRange, setDurationRange] = useState<{ min?: string; max?: string }>({});

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

  const performSearch = useCallback(async (searchQuery: string, searchFilters: SearchFilters) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await searchTracks(searchQuery.trim(), 20, searchFilters);
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
        void performSearch(value, filters);
      }, 300);
    } else {
      setResults([]);
      setShowResults(false);
    }
  }, [performSearch, filters]);

  const handleFilterChange = useCallback(() => {
    const newFilters: SearchFilters = {};
    
    if (yearRange.min) {
      const parsed = parseInt(yearRange.min, 10);
      if (!isNaN(parsed)) newFilters.yearMin = parsed;
    }
    if (yearRange.max) {
      const parsed = parseInt(yearRange.max, 10);
      if (!isNaN(parsed)) newFilters.yearMax = parsed;
    }
    if (durationRange.min) {
      const parsed = parseInt(durationRange.min, 10);
      if (!isNaN(parsed)) newFilters.durationMin = parsed;
    }
    if (durationRange.max) {
      const parsed = parseInt(durationRange.max, 10);
      if (!isNaN(parsed)) newFilters.durationMax = parsed;
    }

    setFilters(newFilters);
    
    // Re-run search if there's a query
    if (query.trim().length > 0) {
      void performSearch(query, newFilters);
    }
  }, [query, yearRange, durationRange, performSearch]);

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  const handleClearFilters = useCallback(() => {
    setYearRange({});
    setDurationRange({});
    setFilters({});
    
    // Re-run search if there's a query
    if (query.trim().length > 0) {
      void performSearch(query, {});
    }
  }, [query, performSearch]);

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
    <div className="w-full space-y-4">
      {/* Main search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1" ref={searchBoxRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={internalInputRef}
              type="text"
              placeholder="Search by title, artist, or game..."
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => {
                if (results.length > 0) {
                  setShowResults(true);
                }
              }}
              className="pl-10 pr-20"
              aria-label="Search for SID tracks"
              data-testid="advanced-search-input"
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
            <Card
              className="absolute top-full mt-2 w-full z-50 max-h-96 overflow-y-auto shadow-lg"
              data-testid="advanced-search-results"
            >
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
                        <div className="flex gap-1 flex-wrap mt-1">
                          {result.matchedIn.map((field) => (
                            <span
                              key={field}
                              className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded"
                            >
                              {field}
                            </span>
                          ))}
                        </div>
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

        {/* Surprise Me button */}
        {onSurpriseMe && (
          <Button
            variant="outline"
            onClick={onSurpriseMe}
            className="gap-2 whitespace-nowrap"
            title="Play a random track"
            data-testid="surprise-me-button"
          >
            <Sparkles className="h-4 w-4" />
            Surprise Me
          </Button>
        )}
      </div>

      {/* Advanced Filters */}
      <Collapsible open={showFilters} onOpenChange={setShowFilters}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            data-testid="toggle-filters-button"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            Advanced Filters
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Year Range */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Year Range</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    placeholder="Min (e.g., 1985)"
                    value={yearRange.min ?? ''}
                    onChange={(e) => setYearRange({ ...yearRange, min: e.target.value })}
                    className="w-full"
                    min={1980}
                    max={2025}
                    data-testid="year-min-input"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="number"
                    placeholder="Max (e.g., 1990)"
                    value={yearRange.max ?? ''}
                    onChange={(e) => setYearRange({ ...yearRange, max: e.target.value })}
                    className="w-full"
                    min={1980}
                    max={2025}
                    data-testid="year-max-input"
                  />
                </div>
              </div>

              {/* Duration Range (in seconds) */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Duration (seconds)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    placeholder="Min (e.g., 60)"
                    value={durationRange.min ?? ''}
                    onChange={(e) => setDurationRange({ ...durationRange, min: e.target.value })}
                    className="w-full"
                    min={0}
                    data-testid="duration-min-input"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="number"
                    placeholder="Max (e.g., 300)"
                    value={durationRange.max ?? ''}
                    onChange={(e) => setDurationRange({ ...durationRange, max: e.target.value })}
                    className="w-full"
                    min={0}
                    data-testid="duration-max-input"
                  />
                </div>
              </div>

              {/* Filter Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleFilterChange}
                  size="sm"
                  className="flex-1"
                  data-testid="apply-filters-button"
                >
                  Apply Filters
                </Button>
                <Button
                  onClick={handleClearFilters}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  data-testid="clear-filters-button"
                >
                  Clear Filters
                </Button>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
