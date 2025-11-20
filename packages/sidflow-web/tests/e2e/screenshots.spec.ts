import { test, expect, Page, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import {
  applyDarkScreenshotTheme,
  resetThemeState,
  DARK_SCREENSHOT_THEME,
} from './utils/theme';
import { configureE2eLogging } from './utils/logging';
import {
  setupPageCloseMonitoring,
  waitForStablePageState,
  navigateWithErrorContext,
  checkFontsLoaded,
} from './utils/resilience';
import { saveScreenshotIfDifferent } from './utils/image-comparison';

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
      // Wait for loading spinner to disappear
      await page.waitForFunction(() => {
        const loader = document.querySelector('.animate-spin');
        return loader === null;
      }, { timeout: 10000 }).catch(() => { });
      // Ensure content is fully rendered
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'PREFS',
    value: 'prefs',
    screenshot: '02-prefs.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /preferences/i })).toBeVisible();
      // Wait for loading spinner to disappear
      await page.waitForFunction(() => {
        const loader = document.querySelector('.animate-spin');
        return loader === null;
      }, { timeout: 10000 }).catch(() => { });
      // Ensure content is fully rendered
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'FETCH',
    value: 'fetch',
    screenshot: '03-fetch.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /fetch hvsc/i })).toBeVisible();
      // Wait for loading spinner to disappear
      await page.waitForFunction(() => {
        const loader = document.querySelector('.animate-spin');
        return loader === null;
      }, { timeout: 10000 }).catch(() => { });
      // Ensure main content is loaded (not showing "Loading...")
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'RATE',
    value: 'rate',
    screenshot: '04-rate.png',
    verify: async (page) => {
      // Wait for loading spinner to disappear first
      await page.waitForFunction(() => {
        const loader = document.querySelector('.animate-spin');
        return loader === null;
      }, { timeout: 10000 }).catch(() => { });
      // Wait for rate heading with longer timeout for CI
      await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible({ timeout: 10000 });
      // Ensure content is fully rendered
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'CLASSIFY',
    value: 'classify',
    screenshot: '05-classify.png',
    verify: async (page) => {
      try {
        // First check if page/context is still valid
        if (page.isClosed()) {
          throw new Error('Page was closed before verification');
        }

        // Wait for heading with extended timeout
        await expect(page.getByRole('heading', { name: /^classify$/i })).toBeVisible({ timeout: 10000 });

        // Wait for loading spinner to disappear
        await page.waitForFunction(() => {
          const loader = document.querySelector('.animate-spin');
          return loader === null;
        }, { timeout: 10000 }).catch(() => { });

        // Ensure content is fully rendered
        await page.waitForTimeout(1000);
      } catch (error) {
        console.error('[CLASSIFY verify] Verification failed:', error);
        throw error;
      }
    },
  },
  {
    label: 'TRAIN',
    value: 'train',
    screenshot: '06-train.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /train model/i })).toBeVisible();
      // Wait for loading spinner to disappear
      await page.waitForFunction(() => {
        const loader = document.querySelector('.animate-spin');
        return loader === null;
      }, { timeout: 10000 }).catch(() => { });
      // Ensure content is fully rendered
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'PLAY',
    value: 'play',
    screenshot: '07-play.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();
      // Wait for loading spinner to disappear
      await page.waitForFunction(() => {
        const loader = document.querySelector('.animate-spin');
        return loader === null;
      }, { timeout: 10000 }).catch(() => { });
      // Ensure content is fully rendered
      await page.waitForTimeout(1000);
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

  const AGGREGATE_RATING_PAYLOAD = {
    sid_path: STUB_TRACK_TEMPLATE.sidPath,
    community: {
      averageRating: 4.6,
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

  const SID_COLLECTION_PATHS_PAYLOAD = {
    sidPath: '/workspace/hvsc',
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

    await context.route('**/api/rate/aggregate**', async (route) => {
      const url = new URL(route.request().url());
      const sidPath = url.searchParams.get('sid_path') ?? STUB_TRACK_TEMPLATE.sidPath;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            ...AGGREGATE_RATING_PAYLOAD,
            sid_path: sidPath,
          },
        }),
      });
    });
  }

  const STABLE_WAIT_TIMEOUT_MS = 3000;

  async function waitForStableUi(page: Page): Promise<void> {
    // Use the reusable utility for basic stability checks
    await waitForStablePageState(page, {
      domTimeout: STABLE_WAIT_TIMEOUT_MS,
      networkTimeout: 2000,
      fontTimeout: STABLE_WAIT_TIMEOUT_MS,
      throwOnTimeout: false,
    });

    // Ensure the theme attribute is set without waiting for another timeout window.
    const themeLocked = await page.evaluate((expectedTheme) => {
      try {
        const html = document.documentElement;
        html.setAttribute('data-theme', expectedTheme);
        html.dataset.sidflowScreenshotTheme = 'locked';
        return html.getAttribute('data-theme') === expectedTheme;
      } catch {
        return false;
      }
    }, DARK_SCREENSHOT_THEME);

    if (!themeLocked) {
      console.warn('[waitForStableUi] Unable to force screenshot theme attribute.');
    }
  }

  async function setupPlayTab(page: Page): Promise<void> {
    const playNextButton = page.getByRole('button', { name: /play next track/i });
    await playNextButton.waitFor({ state: 'visible', timeout: 15000 });
    await playNextButton.click();

    // Wait for the now playing card to populate and pause button to be ready
    await page.waitForSelector('text=/Test Tone C4/i', { timeout: 15000 });
    await page.waitForFunction(() => {
      const pauseButton = document.querySelector('button[aria-label*="Pause playback"]');
      return pauseButton && !pauseButton.hasAttribute('disabled');
    }, { timeout: 10000 });
  }

  const playTabScenario = TABS.find((tab) => tab.value === 'play');
  if (playTabScenario) {
    playTabScenario.setup = setupPlayTab;
  }

  // Increase timeout for screenshot tests to account for CI resource contention
  test.setTimeout(60000);
  test.describe('Tab Screenshots', () => {
    test.beforeAll(() => {
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
    });

    test.beforeEach(async ({ page }, testInfo) => {
      // Set up monitoring before fixtures are installed
      setupPageCloseMonitoring(page, testInfo.title);

      await installScreenshotFixtures(page);
      await applyDarkScreenshotTheme(page);
    });

    test.afterEach(async ({ page }) => {
      await resetThemeState(page);
    });

    const adminTabs = new Set(['wizard', 'fetch', 'rate', 'classify', 'train']);

    for (const tab of TABS) {
      test(`${tab.label} tab screenshot`, async ({ page }) => {
        try {
          const basePath = adminTabs.has(tab.value) ? '/admin' : '/';
          const url = `${basePath}?tab=${tab.value}`;

          // Navigate with error context and page closure detection
          await navigateWithErrorContext(page, url, 30000);

          // Run optional setup with error handling
          if (tab.setup) {
            await tab.setup(page);
          }

          // Verify tab content is present
          await tab.verify(page);

          // Wait for UI to stabilize
          await waitForStableUi(page);

          // Apply screenshot theme with error handling
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

          // Take screenshot to temporary location first
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidflow-screenshot-'));
          const tempPath = path.join(tempDir, tab.screenshot);
          const finalPath = path.join(screenshotDir, tab.screenshot);

          try {
            await page.screenshot({
              path: tempPath,
              fullPage: true,
              timeout: 10000,
            });

            // Compare and conditionally save
            const saved = await saveScreenshotIfDifferent(tempPath, finalPath);
            if (saved) {
              console.log(`[${tab.label}] Screenshot updated: ${tab.screenshot}`);
            } else {
              console.log(`[${tab.label}] Screenshot unchanged: ${tab.screenshot}`);
            }
          } finally {
            // Clean up temp directory
            try {
              fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
              console.warn(`[${tab.label}] Failed to clean up temp directory:`, cleanupError);
            }
          }
        } catch (error) {
          console.error(`[${tab.label} screenshot] Test failed:`, error);
          throw error;
        }
      });
    }
  });
}
