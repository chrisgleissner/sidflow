import type { BrowserContext, Page } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';

const FAST_AUDIO_TESTS =
  (process.env.NEXT_PUBLIC_SIDFLOW_FAST_AUDIO_TESTS ?? process.env.SIDFLOW_FAST_AUDIO_TESTS) === '1';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_SID_PATH = path.resolve(CURRENT_DIR, '../../../../libsidplayfp-wasm/test-tone-c4.sid');
const TEST_SID_BUFFER = readFileSync(TEST_SID_PATH);
const TEST_SID_DATA_URL = `data:application/octet-stream;base64,${TEST_SID_BUFFER.toString('base64')}`;

const playTabRoutesInstalled = new WeakSet<BrowserContext>();

export const STATION_NAME = 'Station: Test Tone Radio';
export const STATION_TRACK_TITLES = ['Station Track Alpha', 'Station Track Beta'] as const;
export const COMMUNITY_AVERAGE_RATING = 4.2;
export const PERSONAL_RATING_VALUE = 5;

const PREFS_PAYLOAD = {
  hvscRoot: '/test-workspace/hvsc',
  defaultCollectionPath: '/test-workspace/hvsc/C64Music',
  activeCollectionPath: '/test-workspace/hvsc/C64Music',
  preferenceSource: 'default' as const,
  preferences: {
    sidBasePath: '/test-workspace/hvsc/C64Music',
    kernalRomPath: null,
    basicRomPath: null,
    chargenRomPath: null,
    sidplayfpCliFlags: null,
    renderEngine: 'wasm',
    preferredEngines: ['wasm', 'sidplayfp-cli'],
  },
  sidplayfpConfig: {
    path: '/test-workspace/.sidplayfp/sidplayfp.conf',
    exists: true,
    contents: '# sidplayfp configuration stub',
    kernalRomPath: null,
    basicRomPath: null,
    chargenRomPath: null,
  },
};

const SID_COLLECTION_PATHS_PAYLOAD = {
  sidPath: '/test-workspace/hvsc',
  musicPath: '/test-workspace/hvsc/C64Music',
  activeCollectionPath: '/test-workspace/hvsc/C64Music',
  preferenceSource: 'default' as const,
};

const PLAYBACK_ADAPTERS_PAYLOAD = {
  adapters: {
    wasm: { available: true },
    'sidplayfp-cli': { available: false, reasons: ['sidplayfp CLI not detected'] },
    'stream-wav': { available: false, reasons: ['No WAV cache detected'] },
    'stream-m4a': { available: false, reasons: ['No M4A cache detected'] },
    ultimate64: { available: false, reasons: ['SIDFLOW_ULTIMATE64_HOST not set'] },
  },
};

const HVSC_BROWSE_PAYLOAD = {
  relativePath: '',
  absolutePath: '/test-workspace/hvsc',
  entries: [
    { name: 'C64Music', path: '/test-workspace/hvsc/C64Music', hasChildren: true },
    { name: 'DEMOS', path: '/test-workspace/hvsc/DEMOS', hasChildren: true },
    { name: 'MUSICIANS', path: '/test-workspace/hvsc/MUSICIANS', hasChildren: true },
  ],
};

const RATING_HISTORY_PAYLOAD = {
  total: 1,
  page: 1,
  pageSize: 15,
  items: [
    {
      id: 'history-entry-1',
      sidPath: '/virtual/test-tone-c4.sid',
      relativePath: 'virtual/test-tone-c4.sid',
      filename: 'test-tone-c4.sid',
      metadata: {
        title: 'Test Tone C4',
        author: 'SIDFlow',
        released: '2024',
      },
      ratings: {
        e: 4,
        m: 3,
        c: 2,
        p: 5,
      },
      updatedAt: new Date().toISOString(),
    },
  ],
};

const FETCH_PROGRESS_PAYLOAD = {
  status: 'idle' as const,
  processedFiles: 0,
  totalFiles: 0,
  updatedAt: Date.now(),
};

const CLASSIFY_PROGRESS_PAYLOAD = {
  phase: 'idle' as const,
  percentComplete: 0,
  processedFiles: 0,
  totalFiles: 0,
  renderedFiles: 0,
  taggedFiles: 0,
  skippedFiles: 0,
  threads: 0,
  perThread: [] as const,
  isActive: false,
  isPaused: false,
  updatedAt: Date.now(),
  startedAt: Date.now(),
};

type TrackRegistry = Map<string, RateTrackInfo>;

function buildTrack(slug: string, displayName: string): RateTrackInfo {
  return {
    sidPath: `/virtual/${slug}.sid`,
    relativePath: `virtual/${slug}.sid`,
    filename: `${slug}.sid`,
    displayName,
    selectedSong: 1,
    metadata: {
      title: displayName,
      author: 'SIDFlow',
      released: '1987',
      songs: 1,
      startSong: 1,
      sidType: 'PSID',
      version: 2,
      sidModel: '6581',
      clock: 'PAL',
      length: '00:03',
      fileSizeBytes: TEST_SID_BUFFER.length,
    },
    durationSeconds: FAST_AUDIO_TESTS ? 1 : 3,
  };
}

function registerSession(scope: 'play' | 'manual', track?: RateTrackInfo): PlaybackSessionDescriptor {
  return {
    sessionId: `${scope}-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sidUrl: TEST_SID_DATA_URL,
    scope,
    durationSeconds: track?.durationSeconds ?? (FAST_AUDIO_TESTS ? 1 : 3),
    selectedSong: track?.selectedSong ?? 1,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    romUrls: {},
    fallbackHlsUrl: null,
  };
}

function formatAggregatePayload(sidPath: string) {
  return {
    sid_path: sidPath,
    community: {
      averageRating: COMMUNITY_AVERAGE_RATING,
      totalRatings: 128,
      likes: 96,
      dislikes: 4,
      skips: 6,
      plays: 540,
      dimensions: {
        energy: 4,
        mood: 5,
        complexity: 3,
      },
    },
    trending: {
      score: 0.92,
      recentPlays: 32,
      isTrending: true,
    },
  };
}

function getOrCreateTrack(registry: TrackRegistry, sidPath?: string, fallbackSlug?: string, fallbackName?: string): RateTrackInfo {
  if (sidPath && registry.has(sidPath)) {
    return registry.get(sidPath)!;
  }
  const slugSource = sidPath ? sidPath.replace(/\.sid$/i, '').split('/').slice(-1)[0] : fallbackSlug ?? 'playlist-track';
  const normalizedSlug = slugSource.replace(/\s+/g, '-').toLowerCase();
  const displayName = fallbackName ?? slugSource
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const track = buildTrack(normalizedSlug, displayName);
  registry.set(track.sidPath, track);
  return track;
}

function createPlaylistTrackFactory(registry: TrackRegistry) {
  let playlistTrackCounter = 0;
  return function createPlaylistTrack(): RateTrackInfo {
    playlistTrackCounter += 1;
    const slug = `playlist-track-${playlistTrackCounter}`;
    const track = buildTrack(slug, `Playlist Track ${playlistTrackCounter}`);
    registry.set(track.sidPath, track);
    return track;
  };
}

function createStationTracks(registry: TrackRegistry): RateTrackInfo[] {
  return STATION_TRACK_TITLES.map((title, index) => {
    const slug = `station-track-${index + 1}`;
    const track = buildTrack(slug, title);
    registry.set(track.sidPath, track);
    return track;
  });
}

export async function installPlayTabRoutes(page: Page): Promise<void> {
  const context = page.context();
  if (playTabRoutesInstalled.has(context)) {
    return;
  }
  playTabRoutesInstalled.add(context);

  const trackRegistry: TrackRegistry = new Map();
  const createPlaylistTrack = createPlaylistTrackFactory(trackRegistry);

  await context.route('**/api/prefs/folders**', async (route) => {
    const url = new URL(route.request().url());
    const relative = url.searchParams.get('relative');
    if (relative && relative.length > 0) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            relativePath: relative,
            absolutePath: path.join('/test-workspace/hvsc', relative),
            entries: [],
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: HVSC_BROWSE_PAYLOAD }),
    });
  });

  await context.route('**/api/prefs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: PREFS_PAYLOAD }),
    });
  });

  await context.route('**/api/playback/detect', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: PLAYBACK_ADAPTERS_PAYLOAD }),
    });
  });

  await context.route('**/api/config/sid', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: SID_COLLECTION_PATHS_PAYLOAD }),
    });
  });

  await context.route('**/api/fetch/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: FETCH_PROGRESS_PAYLOAD }),
    });
  });

  await context.route('**/api/fetch', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          output: 'Fetch skipped in play-tab fixture.',
          logs: 'Fetch skipped in play-tab fixture.',
          progress: FETCH_PROGRESS_PAYLOAD,
        },
      }),
    });
  });

  await context.route('**/api/classify/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: CLASSIFY_PROGRESS_PAYLOAD }),
    });
  });

  await context.route('**/api/classify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          output: 'Classification skipped in play-tab fixture.',
          logs: 'Classification skipped in play-tab fixture.',
          progress: CLASSIFY_PROGRESS_PAYLOAD,
        },
      }),
    });
  });

  await context.route('**/api/rate/history**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: RATING_HISTORY_PAYLOAD }),
    });
  });

  await context.route('**/api/rate/aggregate**', async (route) => {
    const url = new URL(route.request().url());
    const sidPath = url.searchParams.get('sid_path') ?? '/virtual/playlist-track-1.sid';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: formatAggregatePayload(sidPath) }),
    });
  });

  await context.route('**/api/play/random', async (route) => {
    const track = createPlaylistTrack();
    const session = registerSession('play', track);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          track,
          session,
        },
      }),
    });
  });

  await context.route('**/api/play/manual', async (route) => {
    let sidPath: string | undefined;
    try {
      const payload = JSON.parse(route.request().postData() ?? '{}');
      sidPath = typeof payload?.sid_path === 'string' ? payload.sid_path : undefined;
    } catch {
      sidPath = undefined;
    }
    const track = sidPath
      ? getOrCreateTrack(trackRegistry, sidPath)
      : createPlaylistTrack();
    const session = registerSession('manual', track);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { track, session } }),
    });
  });

  await context.route('**/api/play/station-from-song', async (route) => {
    let sidPath: string | undefined;
    try {
      const payload = JSON.parse(route.request().postData() ?? '{}');
      sidPath = typeof payload?.sid_path === 'string' ? payload.sid_path : undefined;
    } catch {
      sidPath = undefined;
    }
    const similarTracks = createStationTracks(trackRegistry);
    const seedTrack = sidPath
      ? getOrCreateTrack(trackRegistry, sidPath)
      : similarTracks[0];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          seedTrack,
          similarTracks,
          stationName: STATION_NAME,
        },
      }),
    });
  });
}
