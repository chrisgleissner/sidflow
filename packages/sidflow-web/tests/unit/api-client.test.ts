import { afterEach, describe, expect, it } from 'bun:test';
import {
  classifyPath,
  controlClassification,
  controlRatePlayback,
  fetchHvsc,
  fetchHvscProgress,
  getClassifyProgress,
  getSidCollectionPaths,
  getPreferences,
  getRatePlaybackStatus,
  getRatingHistory,
  listHvscFolders,
  playManualTrack,
  playTrack,
  rateTrack,
  requestRandomPlayTrack,
  requestRandomRateTrack,
  trainModel,
  updatePreferences,
  requestStationFromSong,
  getAggregateRating,
  getFavorites,
  addFavorite,
  removeFavorite,
  searchTracks,
  getCharts,
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  reorderPlaylistTracks,
  getSchedulerConfig,
  updateSchedulerConfig,
  exportClassifications,
  importClassifications,
} from '../../lib/api-client';
import type {
  ClassifyProgressWithStorage,
  FolderListing,
  SidCollectionPathsPayload,
  PreferencesPayload,
  RatePlaybackStatus,
  RateTrackWithSession,
  RatingHistoryResponse,
  StationFromSongRequest,
  StationFromSongResponse,
  AggregateRating,
  FavoritesResponse,
  SearchResponse,
  ChartsResponse,
  ChartEntry,
  SchedulerResponse,
  ClassificationExportData,
} from '../../lib/api-client';
import type { ClassifyProgressSnapshot } from '../../lib/types/classify-progress';
import type { FetchProgressSnapshot } from '../../lib/types/fetch-progress';
import type {
  ApiResponse,
  PlayRequest,
  RateRequest,
  FetchRequest,
  TrainRequest,
  RateControlRequest,
} from '../../lib/validation';

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let fetchCalls: FetchCall[] = [];

function normalizeUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return String(input);
}

function mockFetch(responseData: unknown): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    fetchCalls.push({ url: normalizeUrl(input), init });
    return new Response(JSON.stringify(responseData), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchCalls = [];
});

const sampleTrackInfo: RateTrackWithSession['track'] = {
  sidPath: '/music/example.sid',
  relativePath: 'example.sid',
  filename: 'example.sid',
  displayName: 'Example Track',
  selectedSong: 1,
  durationSeconds: 180,
  metadata: {
    title: 'Example Track',
    author: 'Composer',
    released: '1988',
    songs: 1,
    startSong: 1,
    sidType: 'PSID',
    version: 2,
    sidModel: '6581',
    clock: 'PAL',
    fileSizeBytes: 2048,
  },
};

const sampleSession: RateTrackWithSession['session'] = {
  sessionId: 'session-123',
  sidUrl: '/api/play/manual/session-123',
  scope: 'play',
  durationSeconds: 180,
  selectedSong: 1,
  expiresAt: new Date(0).toISOString(),
};

const sampleRateTrackWithSession: RateTrackWithSession = {
  track: sampleTrackInfo,
  session: sampleSession,
};

const preferencesPayload: PreferencesPayload = {
  hvscRoot: '/hvsc',
  defaultCollectionPath: '/collections/default',
  activeCollectionPath: '/collections/active',
  preferenceSource: 'default',
  config: {
    maxRenderSec: 10,
    maxClassifySec: 10,
  },
  preferences: {},
  sidplayfpConfig: {
    path: '/cfg/sidplayfp.ini',
    exists: false,
    contents: '',
    kernalRomPath: null,
    basicRomPath: null,
    chargenRomPath: null,
  },
};

const folderListing: FolderListing = {
  relativePath: '',
  absolutePath: '/hvsc',
  entries: [
    {
      name: 'C64Music',
      path: '/hvsc/C64Music',
      hasChildren: true,
    },
  ],
};

const fetchProgressSnapshot: FetchProgressSnapshot = {
  phase: 'downloading',
  percent: 50,
  message: 'downloading archive',
  logs: ['start'],
  updatedAt: 0,
  isActive: true,
};

const classifyProgressSnapshot: ClassifyProgressSnapshot = {
  phase: 'idle',
  totalFiles: 1,
  processedFiles: 1,
  renderedFiles: 1,
  taggedFiles: 1,
  cachedFiles: 0,
  skippedFiles: 0,
  extractedFiles: 1,
  featureHealthCheckedFiles: 1,
  completeFeatureFiles: 1,
  completeFeaturePercent: 100,
  percentComplete: 100,
  threads: 1,
  perThread: [],
  isActive: false,
  isPaused: false,
  updatedAt: 0,
  startedAt: 0,
};

const classifyProgressWithStorage: ClassifyProgressWithStorage = {
  ...classifyProgressSnapshot,
  storage: {
    totalBytes: 1024,
    freeBytes: 512,
    usedBytes: 512,
  },
};

const ratePlaybackStatusSample: RatePlaybackStatus = {
  active: true,
  isPaused: false,
  positionSeconds: 42,
  durationSeconds: 180,
  sidPath: sampleTrackInfo.sidPath,
  track: sampleTrackInfo,
};

const sidPathsPayload: SidCollectionPathsPayload = {
  sidPath: '/hvsc',
  musicPath: '/hvsc/MUSIC',
  activeCollectionPath: '/collections/active',
  preferenceSource: 'default',
};

const ratingHistory: RatingHistoryResponse = {
  total: 1,
  page: 1,
  pageSize: 25,
  items: [
    {
      id: 'event-1',
      sidPath: sampleTrackInfo.sidPath,
      relativePath: sampleTrackInfo.relativePath,
      filename: sampleTrackInfo.filename,
      ratings: { e: 5, m: 4, c: 3, p: 2 },
      timestamp: '2024-01-01T00:00:00Z',
    },
  ],
};

describe('api-client POST helpers', () => {
  const playRequest: PlayRequest = { sid_path: sampleTrackInfo.sidPath, preset: 'ambient' };
  const rateRequest: RateRequest = {
    sid_path: sampleTrackInfo.sidPath,
    ratings: { e: 4, m: 3, c: 5, p: 2 },
  };
  const fetchRequest: FetchRequest = {
    configPath: '/tmp/config.json',
    remoteBaseUrl: 'https://example.invalid',
    hvscVersionPath: '/tmp/version.json',
  };
  const trainRequest: TrainRequest = {
    configPath: '/tmp/train.json',
    epochs: 2,
    batchSize: 64,
    learningRate: 0.01,
    evaluate: true,
  };
  const rateControlRequest: RateControlRequest = {
    action: 'seek',
    positionSeconds: 12,
  };
  const preferencesUpdate = {
    sidBasePath: '/music',
    kernalRomPath: null,
    basicRomPath: null,
    chargenRomPath: null,
  };
  const preferencesWithFormats = {
    defaultFormats: ['wav', 'flac', 'm4a'],
  };

  const postScenarios: Array<{
    name: string;
    endpoint: string;
    invoke: () => Promise<ApiResponse<any>>;
    expectedBody: string;
    response: ApiResponse<any>;
  }> = [
      {
        name: 'playTrack',
        endpoint: '/api/play',
        invoke: () => playTrack(playRequest),
        expectedBody: JSON.stringify(playRequest),
        response: { success: true, data: { output: 'ready' } },
      },
      {
        name: 'playManualTrack',
        endpoint: '/api/play/manual',
        invoke: () => playManualTrack(playRequest),
        expectedBody: JSON.stringify(playRequest),
        response: { success: true, data: sampleRateTrackWithSession },
      },
      {
        name: 'rateTrack',
        endpoint: '/api/rate',
        invoke: () => rateTrack(rateRequest),
        expectedBody: JSON.stringify(rateRequest),
        response: { success: true, data: { message: 'saved', tagPath: '/tags/example.json' } },
      },
      {
        name: 'classifyPath',
        endpoint: '/api/classify',
        invoke: () => classifyPath(),
        expectedBody: JSON.stringify({ async: true }),
        response: { success: true, data: { started: true, jobId: 'classify-123', logs: 'log output', progress: classifyProgressSnapshot } },
      },
      {
        name: 'updatePreferences',
        endpoint: '/api/prefs',
        invoke: () => updatePreferences(preferencesUpdate),
        expectedBody: JSON.stringify(preferencesUpdate),
        response: { success: true, data: preferencesPayload },
      },
      {
        name: 'fetchHvsc',
        endpoint: '/api/fetch',
        invoke: () => fetchHvsc(fetchRequest),
        expectedBody: JSON.stringify(fetchRequest),
        response: { success: true, data: { output: 'fetch-started', logs: 'log output', progress: fetchProgressSnapshot } },
      },
      {
        name: 'trainModel',
        endpoint: '/api/train',
        invoke: () => trainModel(trainRequest),
        expectedBody: JSON.stringify(trainRequest),
        response: { success: true, data: { output: 'trained' } },
      },
      {
        name: 'controlRatePlayback',
        endpoint: '/api/rate/control',
        invoke: () => controlRatePlayback(rateControlRequest),
        expectedBody: JSON.stringify(rateControlRequest),
        response: { success: true, data: { message: 'ok' } },
      },
      {
        name: 'controlClassification',
        endpoint: '/api/classify/control',
        invoke: () => controlClassification('pause'),
        expectedBody: JSON.stringify({ action: 'pause' }),
        response: { success: true, data: { progress: classifyProgressWithStorage } },
      },
    ];

  for (const scenario of postScenarios) {
    it(`${scenario.name} posts JSON payload to ${scenario.endpoint}`, async () => {
      mockFetch(scenario.response);

      const result = await scenario.invoke();

      expect(fetchCalls).toHaveLength(1);
      const call = fetchCalls[0];
      expect(call.url).toBe(scenario.endpoint);
      expect(call.init?.method).toBe('POST');
      expect(call.init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(call.init?.body).toBe(scenario.expectedBody);
      expect(result).toEqual(scenario.response);
    });
  }
});

describe('api-client fetch wrappers', () => {
  it('getPreferences performs a GET request', async () => {
    const response: ApiResponse<PreferencesPayload> = { success: true, data: preferencesPayload };
    mockFetch(response);

    const result = await getPreferences();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/prefs');
    expect(call.init?.method).toBe('GET');
    expect(call.init?.headers).toEqual({ Accept: 'application/json' });
    expect(call.init?.body).toBeUndefined();
    expect(result).toEqual(response);
  });

  it('listHvscFolders includes a relative query parameter when provided', async () => {
    const response: ApiResponse<FolderListing> = { success: true, data: folderListing };
    mockFetch(response);

    const result = await listHvscFolders('C64Music');

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/prefs/folders?relative=C64Music');
    expect(call.init?.method).toBe('GET');
    expect(call.init?.headers).toEqual({ Accept: 'application/json' });
    expect(result).toEqual(response);
  });

  it('listHvscFolders defaults to an empty query string', async () => {
    const response: ApiResponse<FolderListing> = { success: true, data: folderListing };
    mockFetch(response);

    const result = await listHvscFolders();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/prefs/folders?');
    expect(result).toEqual(response);
  });

  it('fetchHvscProgress requests current fetch status', async () => {
    const response: ApiResponse<FetchProgressSnapshot> = { success: true, data: fetchProgressSnapshot };
    mockFetch(response);

    const result = await fetchHvscProgress();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/fetch/progress');
    expect(call.init?.method).toBe('GET');
    expect(call.init?.headers).toEqual({ Accept: 'application/json' });
    expect(result).toEqual(response);
  });

  it('getSidCollectionPaths retrieves configured SID collection paths', async () => {
    const response: ApiResponse<SidCollectionPathsPayload> = { success: true, data: sidPathsPayload };
    mockFetch(response);

    const result = await getSidCollectionPaths();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/config/sid');
    expect(result).toEqual(response);
  });

  it('getClassifyProgress fetches classify progress snapshots', async () => {
    const response: ApiResponse<ClassifyProgressWithStorage> = { success: true, data: classifyProgressWithStorage };
    mockFetch(response);

    const result = await getClassifyProgress();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/classify/progress');
    expect(result).toEqual(response);
  });

  it('getRatePlaybackStatus retrieves pause/playback state', async () => {
    const response: ApiResponse<RatePlaybackStatus> = { success: true, data: ratePlaybackStatusSample };
    mockFetch(response);

    const result = await getRatePlaybackStatus();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/rate/status');
    expect(result).toEqual(response);
  });

  it('requestRandomPlayTrack posts optional preset and preview flags', async () => {
    const response: ApiResponse<{ track: RateTrackWithSession['track']; session: RateTrackWithSession['session'] | null }> = {
      success: true,
      data: { track: sampleTrackInfo, session: sampleSession },
    };
    mockFetch(response);

    const result = await requestRandomPlayTrack('energetic', { preview: true });

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/play/random');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(call.init?.body).toBe(JSON.stringify({ preset: 'energetic', preview: true }));
    expect(result).toEqual(response);
  });

  it('requestRandomPlayTrack omits optional fields when not provided', async () => {
    const response: ApiResponse<{ track: RateTrackWithSession['track']; session: RateTrackWithSession['session'] | null }> = {
      success: true,
      data: { track: sampleTrackInfo, session: sampleSession },
    };
    mockFetch(response);

    const result = await requestRandomPlayTrack();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.init?.body).toBe(JSON.stringify({}));
    expect(result).toEqual(response);
  });

  it('requestRandomRateTrack posts an empty body', async () => {
    const response: ApiResponse<RateTrackWithSession> = { success: true, data: sampleRateTrackWithSession };
    mockFetch(response);

    const result = await requestRandomRateTrack();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/rate/random');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.body).toBe(JSON.stringify({}));
    expect(result).toEqual(response);
  });

  it('getRatingHistory serializes query parameters when provided', async () => {
    const response: ApiResponse<RatingHistoryResponse> = { success: true, data: ratingHistory };
    mockFetch(response);

    const result = await getRatingHistory({ page: 2, pageSize: 25, query: 'knight' });

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/rate/history?page=2&pageSize=25&query=knight');
    expect(call.init?.method).toBe('GET');
    expect(call.init?.headers).toEqual({ Accept: 'application/json' });
    expect(result).toEqual(response);
  });
});

describe('requestStationFromSong', () => {
  it('POSTs to /api/play/station-from-song with the request body', async () => {
    const stationResponse: StationFromSongResponse = {
      seedTrack: sampleTrackInfo as any,
      similarTracks: [],
      stationName: 'Songs Like Example',
    };
    const response: ApiResponse<StationFromSongResponse> = { success: true, data: stationResponse };
    mockFetch(response);

    const request: StationFromSongRequest = { sid_path: '/music/example.sid', limit: 10, similarity: 0.8 };
    const result = await requestStationFromSong(request);

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/play/station-from-song');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(call.init?.body).toBe(JSON.stringify(request));
    expect(result).toEqual(response);
  });
});

describe('getAggregateRating', () => {
  it('GETs /api/rate/aggregate with sid_path query param', async () => {
    const rating: AggregateRating = { avgRating: 4.2, ratingCount: 17, weightedScore: 4.1, confidence: 0.9 };
    const response: ApiResponse<AggregateRating> = { success: true, data: rating };
    mockFetch(response);

    const result = await getAggregateRating('/music/foo.sid');

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/rate/aggregate?sid_path=%2Fmusic%2Ffoo.sid');
    expect(call.init?.method).toBe('GET');
    expect(result).toEqual(response);
  });
});

describe('getFavorites / addFavorite / removeFavorite', () => {
  it('getFavorites GETs /api/favorites', async () => {
    const response: ApiResponse<FavoritesResponse> = { success: true, data: { favorites: ['/a.sid'] } };
    mockFetch(response);

    const result = await getFavorites();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/favorites');
    expect(call.init?.method).toBe('GET');
    expect(result).toEqual(response);
  });

  it('addFavorite POSTs sid_path to /api/favorites', async () => {
    const response: ApiResponse<{ favorites: string[]; added: boolean }> = {
      success: true,
      data: { favorites: ['/a.sid'], added: true },
    };
    mockFetch(response);

    const result = await addFavorite('/a.sid');

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/favorites');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.body).toBe(JSON.stringify({ sid_path: '/a.sid' }));
    expect(result).toEqual(response);
  });

  it('removeFavorite DELETEs sid_path from /api/favorites', async () => {
    const response: ApiResponse<{ favorites: string[]; removed: boolean }> = {
      success: true,
      data: { favorites: [], removed: true },
    };
    mockFetch(response);

    const result = await removeFavorite('/a.sid');

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/favorites');
    expect(call.init?.method).toBe('DELETE');
    expect(call.init?.body).toBe(JSON.stringify({ sid_path: '/a.sid' }));
    expect(result).toEqual(response);
  });
});

describe('searchTracks', () => {
  it('GETs /api/search with query only', async () => {
    const response: ApiResponse<SearchResponse> = {
      success: true,
      data: { query: 'knight', results: [], total: 0, limit: 20 },
    };
    mockFetch(response);

    const result = await searchTracks('knight');

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/search?q=knight');
    expect(call.init?.method).toBe('GET');
    expect(result).toEqual(response);
  });

  it('includes limit param when provided', async () => {
    const response: ApiResponse<SearchResponse> = {
      success: true,
      data: { query: 'rob', results: [], total: 0, limit: 5 },
    };
    mockFetch(response);

    await searchTracks('rob', 5);

    expect(fetchCalls[0].url).toBe('/api/search?q=rob&limit=5');
  });

  it('includes all filter params when provided', async () => {
    const response: ApiResponse<SearchResponse> = {
      success: true,
      data: { query: 'tune', results: [], total: 0, limit: 20 },
    };
    mockFetch(response);

    await searchTracks('tune', undefined, {
      yearMin: 1985,
      yearMax: 1990,
      chipModel: 'MOS6581',
      sidModel: '6581',
      durationMin: 60,
      durationMax: 300,
      minRating: 3,
    });

    const url = fetchCalls[0].url;
    expect(url).toContain('q=tune');
    expect(url).toContain('yearMin=1985');
    expect(url).toContain('yearMax=1990');
    expect(url).toContain('chipModel=MOS6581');
    expect(url).toContain('sidModel=6581');
    expect(url).toContain('durationMin=60');
    expect(url).toContain('durationMax=300');
    expect(url).toContain('minRating=3');
  });
});

describe('getCharts', () => {
  it('GETs /api/charts with default range=week', async () => {
    const entry: ChartEntry = { sidPath: '/a.sid', displayName: 'A', artist: 'X', playCount: 5, avgRating: 4.0, rank: 1 };
    const response: ApiResponse<ChartsResponse> = {
      success: true,
      data: { range: 'week', charts: [entry] },
    };
    mockFetch(response);

    const result = await getCharts();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/charts?range=week');
    expect(call.init?.method).toBe('GET');
    expect(result).toEqual(response);
  });

  it('includes limit when provided', async () => {
    const response: ApiResponse<ChartsResponse> = {
      success: true,
      data: { range: 'month', charts: [] },
    };
    mockFetch(response);

    await getCharts('month', 10);

    expect(fetchCalls[0].url).toBe('/api/charts?range=month&limit=10');
  });
});

describe('Playlist API', () => {
  it('listPlaylists GETs /api/playlists', async () => {
    mockFetch({ success: true, data: [] });
    await listPlaylists();
    expect(fetchCalls[0].url).toBe('/api/playlists');
    expect(fetchCalls[0].init?.method).toBe('GET');
  });

  it('getPlaylist GETs /api/playlists/:id', async () => {
    mockFetch({ success: true, data: { id: 'abc', name: 'My List' } });
    await getPlaylist('abc');
    expect(fetchCalls[0].url).toBe('/api/playlists/abc');
    expect(fetchCalls[0].init?.method).toBe('GET');
  });

  it('createPlaylist POSTs to /api/playlists', async () => {
    mockFetch({ success: true, data: { id: 'new' } });
    const tracks = [{ sidPath: '/a.sid', title: 'A' }];
    await createPlaylist('My List', 'desc', tracks);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/playlists');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.body).toBe(JSON.stringify({ name: 'My List', description: 'desc', tracks }));
  });

  it('updatePlaylist PUTs to /api/playlists/:id', async () => {
    mockFetch({ success: true, data: {} });
    await updatePlaylist('abc', { name: 'Updated' });
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/playlists/abc');
    expect(call.init?.method).toBe('PUT');
    expect(call.init?.body).toBe(JSON.stringify({ name: 'Updated' }));
  });

  it('deletePlaylist DELETEs /api/playlists/:id', async () => {
    mockFetch({ success: true });
    await deletePlaylist('abc');
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/playlists/abc');
    expect(call.init?.method).toBe('DELETE');
  });

  it('reorderPlaylistTracks POSTs trackOrder to /api/playlists/:id/reorder', async () => {
    mockFetch({ success: true });
    await reorderPlaylistTracks('abc', ['/a.sid', '/b.sid']);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/playlists/abc/reorder');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.body).toBe(JSON.stringify({ trackOrder: ['/a.sid', '/b.sid'] }));
  });
});

describe('Scheduler API', () => {
  it('getSchedulerConfig GETs /api/scheduler', async () => {
    const mockData: SchedulerResponse = {
      scheduler: { enabled: false, time: '02:00', timezone: 'UTC' },
      renderPrefs: { preserveWav: false, enableFlac: true, enableM4a: false },
      status: { isActive: false, lastRun: null, nextRun: null, isPipelineRunning: false },
    };
    const response: ApiResponse<SchedulerResponse> = { success: true, data: mockData };
    mockFetch(response);

    const result = await getSchedulerConfig();

    expect(fetchCalls[0].url).toBe('/api/scheduler');
    expect(fetchCalls[0].init?.method).toBe('GET');
    expect(result).toEqual(response);
  });

  it('updateSchedulerConfig POSTs payload to /api/scheduler', async () => {
    const mockData: SchedulerResponse = {
      scheduler: { enabled: true, time: '03:00', timezone: 'UTC' },
      renderPrefs: { preserveWav: false, enableFlac: true, enableM4a: false },
      status: { isActive: false, lastRun: null, nextRun: null, isPipelineRunning: false },
    };
    const response: ApiResponse<SchedulerResponse> = { success: true, data: mockData };
    mockFetch(response);

    const payload = { scheduler: { enabled: true, time: '03:00', timezone: 'UTC' } };
    const result = await updateSchedulerConfig(payload);

    expect(fetchCalls[0].url).toBe('/api/scheduler');
    expect(fetchCalls[0].init?.method).toBe('POST');
    expect(fetchCalls[0].init?.body).toBe(JSON.stringify(payload));
    expect(result).toEqual(response);
  });
});

describe('Classification Export/Import API', () => {
  it('importClassifications POSTs to /api/classify/export', async () => {
    const response: ApiResponse<{ filesWritten: number; entriesWritten: number }> = {
      success: true,
      data: { filesWritten: 5, entriesWritten: 100 },
    };
    mockFetch(response);

    const data: ClassificationExportData = {
      version: '1.0',
      exportedAt: '2025-01-01T00:00:00Z',
      classificationDepth: 3,
      totalEntries: 1,
      classifications: { '/a.sid': { e: 4, m: 3, c: 2, source: 'manual' } },
    };
    const result = await importClassifications(data);

    expect(fetchCalls[0].url).toBe('/api/classify/export');
    expect(fetchCalls[0].init?.method).toBe('POST');
    expect(fetchCalls[0].init?.body).toBe(JSON.stringify(data));
    expect(result).toEqual(response);
  });

  it('exportClassifications GETs /api/classify/export and returns Blob on success', async () => {
    const blobContent = '{"version":"1.0"}';
    fetchCalls = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      fetchCalls.push({ url: typeof input === 'string' ? input : String(input) });
      return new Response(blobContent, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await exportClassifications();

    expect(fetchCalls[0].url).toBe('/api/classify/export');
    expect(result).toBeInstanceOf(Blob);
  });

  it('exportClassifications throws on error response', async () => {
    fetchCalls = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      fetchCalls.push({ url: typeof input === 'string' ? input : String(input) });
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await expect(exportClassifications()).rejects.toThrow('Not found');
  });
});
