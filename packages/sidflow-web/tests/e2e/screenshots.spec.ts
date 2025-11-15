import { test, expect, Page, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import {
  applyDarkScreenshotTheme,
  resetThemeState,
  DARK_SCREENSHOT_THEME,
} from './utils/theme';
import { configureE2eLogging } from './utils/logging';

configureE2eLogging();

const isPlaywrightRunner = Boolean(process.env.PLAYWRIGHT_TEST);

if (!isPlaywrightRunner) {
  console.warn('[sidflow-web] Skipping Playwright tab screenshots e2e spec; run via `bun run test:e2e`.');
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(moduleDir, '../../..', '..', 'doc/web-screenshots');

interface TabScenario {
  label: string;
  value: string;
  screenshot: string;
  setup?: (page: Page) => Promise<void>;
  verify: (page: Page) => Promise<void>;
}

const TABS: TabScenario[] = [
  {
    label: 'WIZARD',
    value: 'wizard',
    screenshot: '01-wizard.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /setup wizard/i })).toBeVisible();
    },
  },
  {
    label: 'PREFS',
    value: 'prefs',
    screenshot: '02-prefs.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /preferences/i })).toBeVisible();
    },
  },
  {
    label: 'FETCH',
    value: 'fetch',
    screenshot: '03-fetch.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /fetch hvsc/i })).toBeVisible();
    },
  },
  {
    label: 'RATE',
    value: 'rate',
    screenshot: '04-rate.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible();
    },
  },
  {
    label: 'CLASSIFY',
    value: 'classify',
    screenshot: '05-classify.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /^classify$/i })).toBeVisible();
    },
  },
  {
    label: 'TRAIN',
    value: 'train',
    screenshot: '06-train.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /train model/i })).toBeVisible();
    },
  },
  {
    label: 'PLAY',
    value: 'play',
    screenshot: '07-play.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();
    },
  },
];

if (isPlaywrightRunner) {
const TEST_SID_PATH = path.resolve(moduleDir, '../../../libsidplayfp-wasm/test-tone-c4.sid');
const TEST_SID_BUFFER = fs.readFileSync(TEST_SID_PATH);
const TEST_SID_DATA_URL = `data:application/octet-stream;base64,${TEST_SID_BUFFER.toString('base64')}`;

const screenshotRoutesInstalled = new WeakSet<BrowserContext>();
let sessionCounter = 0;

const STUB_TRACK_TEMPLATE = {
  sidPath: '/virtual/test-tone-c4.sid',
  relativePath: 'virtual/test-tone-c4.sid',
  filename: 'test-tone-c4.sid',
  displayName: 'Test Tone C4',
  selectedSong: 1,
  metadata: {
    title: 'Test Tone C4',
    author: 'SIDFlow',
    released: '2024',
    songs: 1,
    startSong: 1,
    sidType: 'PSID',
    version: 2,
    sidModel: '6581',
    clock: 'PAL',
    length: '00:03',
    fileSizeBytes: TEST_SID_BUFFER.length,
  },
  durationSeconds: 3,
} as const;

const PREFS_PAYLOAD = {
  hvscRoot: '/workspace/hvsc',
  defaultCollectionPath: '/workspace/hvsc/C64Music',
  activeCollectionPath: '/workspace/hvsc/C64Music',
  preferenceSource: 'default' as const,
  preferences: {
    sidBasePath: null,
    kernalRomPath: null,
    basicRomPath: null,
    chargenRomPath: null,
    sidplayfpCliFlags: null,
  },
  sidplayfpConfig: {
    path: '/workspace/.sidplayfp/sidplayfp.conf',
    exists: true,
    contents: '# sidplayfp configuration stub',
    kernalRomPath: null,
    basicRomPath: null,
    chargenRomPath: null,
  },
};

const HVSC_PATHS_PAYLOAD = {
  hvscPath: '/workspace/hvsc',
  musicPath: '/workspace/hvsc/C64Music',
  activeCollectionPath: '/workspace/hvsc/C64Music',
  preferenceSource: 'default' as const,
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

const PLAYBACK_ADAPTERS_PAYLOAD = {
  adapters: {
    wasm: { available: true },
    'sidplayfp-cli': { available: false, reasons: ['sidplayfp CLI not detected'] },
    'stream-wav': { available: false, reasons: ['No WAV cache detected'] },
    'stream-m4a': { available: false, reasons: ['No M4A cache detected'] },
    ultimate64: { available: false, reasons: ['SIDFLOW_ULTIMATE64_HOST not set'] },
  },
};

function createStubTrack() {
  return {
    ...STUB_TRACK_TEMPLATE,
    metadata: { ...STUB_TRACK_TEMPLATE.metadata },
  };
}

function createSession(scope: 'rate' | 'play') {
  sessionCounter += 1;
  const sessionId = `${scope}-screenshot-${Date.now()}-${sessionCounter}`;
  return {
    sessionId,
    sidUrl: TEST_SID_DATA_URL,
    scope,
    durationSeconds: STUB_TRACK_TEMPLATE.durationSeconds,
    selectedSong: STUB_TRACK_TEMPLATE.selectedSong,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    fallbackHlsUrl: null,
    romUrls: {},
  } as const;
}

function buildFetchProgress() {
  const now = Date.now();
  return {
    phase: 'completed',
    percent: 100,
    message: 'HVSC mirror is up to date.',
    filename: undefined,
    downloadedBytes: 0,
    totalBytes: 0,
    updatedAt: now,
    logs: ['Fetch CLI output available once a run completes.'],
    isActive: false,
  };
}

function buildClassifyProgress() {
  const now = Date.now();
  return {
    phase: 'completed',
    totalFiles: 128,
    processedFiles: 128,
    renderedFiles: 128,
    skippedFiles: 0,
    percentComplete: 100,
    threads: 4,
    perThread: Array.from({ length: 4 }, (_, index) => ({
      id: index + 1,
      status: 'idle' as const,
      updatedAt: now,
    })),
    message: 'Classification idle',
    error: undefined,
    isActive: false,
    isPaused: false,
    updatedAt: now,
    startedAt: now - 60000,
    storage: {
      totalBytes: 1024 * 1024 * 1024,
      freeBytes: 512 * 1024 * 1024,
      usedBytes: 512 * 1024 * 1024,
    },
  };
}

async function installScreenshotFixtures(page: Page): Promise<void> {
  const context = page.context();
  if (screenshotRoutesInstalled.has(context)) {
    return;
  }
  screenshotRoutesInstalled.add(context);

  await context.route('**/virtual/test-tone-c4.sid', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Length': String(TEST_SID_BUFFER.length),
      },
      body: TEST_SID_BUFFER,
    });
  });

  await context.route('**/api/rate/random', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          track: createStubTrack(),
          session: createSession('rate'),
        },
      }),
    });
  });

  await context.route('**/api/play/random', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          track: createStubTrack(),
          session: createSession('play'),
        },
      }),
    });
  });

  await context.route('**/api/play/manual', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          track: createStubTrack(),
          session: createSession('play'),
        },
      }),
    });
  });

  await context.route('**/api/prefs/folders**', async (route) => {
    const url = new URL(route.request().url());
    const relative = url.searchParams.get('relative') ?? '';
    const listing = {
      relativePath: relative,
      absolutePath: relative ? `/workspace/hvsc/${relative}` : '/workspace/hvsc',
      entries: [
        { name: 'C64Music', path: '/workspace/hvsc/C64Music', hasChildren: true },
        { name: 'SIDFX', path: '/workspace/hvsc/SIDFX', hasChildren: false },
      ],
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: listing }),
    });
  });

  await context.route('**/api/prefs', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: PREFS_PAYLOAD }),
      });
      return;
    }
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

  await context.route('**/api/config/hvsc', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: HVSC_PATHS_PAYLOAD }),
    });
  });

  await context.route('**/api/fetch/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: buildFetchProgress() }),
    });
  });

  await context.route('**/api/fetch', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          output: 'Fetch skipped in screenshot mode.',
          logs: 'Fetch skipped in screenshot mode.',
          progress: buildFetchProgress(),
        },
      }),
    });
  });

  await context.route('**/api/classify/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: buildClassifyProgress() }),
    });
  });

  await context.route('**/api/classify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          output: 'Classification skipped in screenshot mode.',
          logs: 'Classification skipped in screenshot mode.',
          progress: buildClassifyProgress(),
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
}

const STABLE_WAIT_TIMEOUT_MS = 2000;

async function waitForStableUi(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  // Next.js dev server holds open WebSocket connections, so `networkidle` may never resolve.
  await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);
  await page
    .waitForFunction(() => document.readyState === 'complete', undefined, {
      timeout: STABLE_WAIT_TIMEOUT_MS,
    })
    .catch(() => undefined);
  await page
    .waitForFunction(
      (expectedTheme) => document.documentElement.getAttribute('data-theme') === expectedTheme,
      DARK_SCREENSHOT_THEME,
      { timeout: STABLE_WAIT_TIMEOUT_MS }
    )
    .catch(() => undefined);
  await page
    .waitForFunction(
      () => {
        if (!(document as any).fonts || typeof (document as any).fonts.status !== 'string') {
          return true;
        }
        return (document as any).fonts.status === 'loaded';
      },
      undefined,
      { timeout: STABLE_WAIT_TIMEOUT_MS }
    )
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

test.setTimeout(45000);
test.describe('Tab Screenshots', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    await installScreenshotFixtures(page);
    await applyDarkScreenshotTheme(page);
  });

  test.afterEach(async ({ page }) => {
    await resetThemeState(page);
  });

  const adminTabs = new Set(['wizard', 'fetch', 'rate', 'classify', 'train']);

  for (const tab of TABS) {
    test(`${tab.label} tab screenshot`, async ({ page }) => {
      const basePath = adminTabs.has(tab.value) ? '/admin' : '/';
      await page.goto(`${basePath}?tab=${tab.value}`, { waitUntil: 'domcontentloaded' });
      if (tab.setup) {
        await tab.setup(page);
      }
      await tab.verify(page);
      await waitForStableUi(page);
      await page.evaluate((expectedTheme) => {
        const html = document.documentElement;
        html.setAttribute('data-theme', expectedTheme);
        html.classList.remove('font-c64', 'font-sans');
        html.classList.add('font-mono');
        const body = document.body;
        if (body) {
          delete (body.dataset as Record<string, string | undefined>).persona;
          body.classList.remove('font-c64', 'font-sans');
          body.classList.add('font-mono');
          const computedBackground = getComputedStyle(html).getPropertyValue('--background').trim();
          if (computedBackground) {
            body.style.setProperty('background', computedBackground);
            body.style.setProperty('background-color', computedBackground);
          } else {
            body.style.setProperty('background', 'var(--background)');
            body.style.setProperty('background-color', 'var(--background)');
          }
        }
      }, DARK_SCREENSHOT_THEME);
      await page.waitForTimeout(100);
      await page.screenshot({
        path: path.join(screenshotDir, tab.screenshot),
        fullPage: true,
      });
    });
  }
});
}
