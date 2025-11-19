import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRepoRoot } from '@/lib/server-env';

interface ClassifiedTrack {
  sid_path: string;
  ratings?: {
    e?: number;
    m?: number;
    c?: number;
    p?: number;
  };
  features?: Record<string, number>;
  metadata?: {
    chipModel?: string;
    sidModel?: string;
    year?: number;
    duration?: number;
  };
}

interface SearchRecord {
  sidPath: string;
  displayName: string;
  artist: string;
  normalized: string;
  year?: number;
  ratings?: {
    e?: number;
    m?: number;
    c?: number;
    p?: number;
  };
  features?: Record<string, number>;
  metadata?: {
    chipModel?: string;
    sidModel?: string;
    year?: number;
    duration?: number;
  };
}

export interface SearchFilters {
  yearMin?: number;
  yearMax?: number;
  chipModel?: string;
  sidModel?: string;
  durationMin?: number;
  durationMax?: number;
  minRating?: number;
}

interface SearchQueryOptions {
  limit: number;
  filters?: SearchFilters;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_TTL_MS = Number(process.env.SIDFLOW_SEARCH_INDEX_TTL_MS ?? 30_000);

export class SearchIndex {
  private records: SearchRecord[] = [];
  private loading: Promise<void> | null = null;
  private lastLoaded = 0;
  private readonly dataPath: string;
  private readonly ttlMs: number;

  constructor(dataPath?: string, ttlMs: number = DEFAULT_TTL_MS) {
    const repoRoot = getRepoRoot();
    const defaultPath = path.join(repoRoot, 'data', 'classified', 'sample.jsonl');
    this.dataPath = dataPath ?? defaultPath;
    this.ttlMs = ttlMs;
  }

  private async loadRecords(): Promise<void> {
    if (this.loading) {
      return this.loading;
    }

    this.loading = (async () => {
      try {
        const content = await fs.readFile(this.dataPath, 'utf8');
        const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const parsed: SearchRecord[] = [];

        for (const line of lines) {
          try {
            const track = JSON.parse(line) as ClassifiedTrack;
            const { artist, title } = parseSidPath(track.sid_path);
            parsed.push({
              sidPath: track.sid_path,
              displayName: title,
              artist,
              normalized: `${title.toLowerCase()} ${artist.toLowerCase()} ${track.sid_path.toLowerCase()}`,
              year: track.metadata?.year,
              ratings: track.ratings,
              features: track.features,
              metadata: track.metadata,
            });
          } catch {
            // ignore malformed lines
          }
        }

        this.records = parsed;
        this.lastLoaded = Date.now();
      } finally {
        this.loading = null;
      }
    })();

    return this.loading;
  }

  private async ensureFresh(): Promise<void> {
    const now = Date.now();
    if (now - this.lastLoaded > this.ttlMs || this.records.length === 0) {
      await this.loadRecords();
    }
  }

  async query(rawQuery: string, options?: Partial<SearchQueryOptions>): Promise<SearchRecord[]> {
    const query = rawQuery.trim().toLowerCase();
    if (query.length === 0) {
      return [];
    }

    await this.ensureFresh();
    const limit = options?.limit && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
    const filters = options?.filters;

    const matches: SearchRecord[] = [];
    for (const record of this.records) {
      if (record.normalized.includes(query)) {
        // Apply filters if present
        if (filters) {
          if (filters.yearMin !== undefined && (!record.year || record.year < filters.yearMin)) {
            continue;
          }
          if (filters.yearMax !== undefined && (!record.year || record.year > filters.yearMax)) {
            continue;
          }
          if (filters.chipModel && record.metadata?.chipModel !== filters.chipModel) {
            continue;
          }
          if (filters.sidModel && record.metadata?.sidModel !== filters.sidModel) {
            continue;
          }
          if (filters.durationMin !== undefined && (!record.metadata?.duration || record.metadata.duration < filters.durationMin)) {
            continue;
          }
          if (filters.durationMax !== undefined && (!record.metadata?.duration || record.metadata.duration > filters.durationMax)) {
            continue;
          }
          if (filters.minRating !== undefined) {
            const avgRating = record.ratings ? ((record.ratings.e ?? 0) + (record.ratings.m ?? 0) + (record.ratings.c ?? 0)) / 3 : 0;
            if (avgRating < filters.minRating) {
              continue;
            }
          }
        }

        matches.push(record);
        if (matches.length >= limit) {
          break;
        }
      }
    }

    return matches;
  }
}

let singleton: SearchIndex | null = null;

export function getSearchIndex(): SearchIndex {
  if (!singleton) {
    singleton = new SearchIndex();
  }
  return singleton;
}

function parseSidPath(sidPath: string): { artist: string; title: string } {
  const parts = sidPath.split('/');
  const filename = parts[parts.length - 1] ?? '';
  const title = filename.replace(/\.sid$/i, '').replace(/_/g, ' ');
  const artistPart = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown';
  return {
    title: title || 'Unknown',
    artist: artistPart.replace(/_/g, ' ') || 'Unknown',
  };
}
