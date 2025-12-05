import { expect, test, type Page, type Route } from './test-hooks';

const ADMIN_USER = process.env.SIDFLOW_ADMIN_USER ?? 'ops';
const ADMIN_PASSWORD = process.env.SIDFLOW_ADMIN_PASSWORD ?? 'test-pass-123';
process.env.SIDFLOW_ADMIN_USER = ADMIN_USER;
process.env.SIDFLOW_ADMIN_PASSWORD = ADMIN_PASSWORD;
const ADMIN_AUTH_HEADER = `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64')}`;
const adminRouteConfigured = new WeakSet<Page>();

const CLASSIFY_TOTAL = 24;
const CLASSIFY_RENDERED = 12;
const CLASSIFY_TAGGED = 7;

const CLASSIFY_PROGRESS_RESPONSE = {
  success: true,
  data: {
    phase: 'tagging',
    totalFiles: CLASSIFY_TOTAL,
    processedFiles: CLASSIFY_TAGGED,
    renderedFiles: CLASSIFY_RENDERED,
    taggedFiles: CLASSIFY_TAGGED,
    skippedFiles: 1,
    percentComplete: 29.2,
    threads: 4,
    perThread: Array.from({ length: 4 }, (_, id) => ({
      id: id + 1,
      status: 'working' as const,
      phase: 'tagging' as const,
      updatedAt: Date.now(),
    })),
    renderEngine: 'wasm → sidplayfp',
    activeEngine: 'wasm',
    isActive: true,
    isPaused: false,
    updatedAt: Date.now(),
    startedAt: Date.now() - 30_000,
    message: 'Rendering in progress',
    storage: {
      totalBytes: 1024 * 1024 * 1024,
      freeBytes: 512 * 1024 * 1024,
      usedBytes: 512 * 1024 * 1024,
    },
  },
};

const SID_PATH_RESPONSE = {
  success: true,
  data: {
    sidPath: '/workspace/hvsc',
    musicPath: '/workspace/hvsc/MUSIC',
    activeCollectionPath: '/workspace/hvsc',
    preferenceSource: 'default' as const,
  },
};

const SCHEDULER_RESPONSE = {
  success: true,
  data: {
    scheduler: {
      enabled: false,
      time: '06:00',
      timezone: 'UTC',
    },
    renderPrefs: {
      preserveWav: true,
      enableFlac: false,
      enableM4a: false,
    },
    status: {
      isActive: false,
      lastRun: null,
      nextRun: null,
      isPipelineRunning: true,
    },
  },
};

async function ensureAdminSession(page: Page): Promise<void> {
  if (adminRouteConfigured.has(page)) {
    return;
  }

  await page.context().setExtraHTTPHeaders({
    Authorization: ADMIN_AUTH_HEADER,
    authorization: ADMIN_AUTH_HEADER,
  });

  await page.context().setHTTPCredentials({
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
  });

  adminRouteConfigured.add(page);
}

async function installClassifyRoutes(page: Page): Promise<void> {
  const context = page.context();

  await context.route('**/api/config/sid', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SID_PATH_RESPONSE),
    });
  });

  await context.route('**/api/scheduler', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SCHEDULER_RESPONSE),
    });
  });

  await context.route('**/api/classify/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CLASSIFY_PROGRESS_RESPONSE),
    });
  });
}

test.describe('Classify progress metrics', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAdminSession(page);
  });

  test('displays rendered and tagged counts', async ({ page }) => {
    await installClassifyRoutes(page);

    await page.goto('/admin?tab=classify', { waitUntil: 'domcontentloaded' });

    // Select from the active tab panel to avoid duplicate testid matches
    const classifyTab = page.getByRole('tabpanel', { name: 'CLASSIFY' });
    const renderedCount = classifyTab.getByTestId('classify-rendered-count');
    const taggedCount = classifyTab.getByTestId('classify-tagged-count');

    await expect(renderedCount).toBeVisible({ timeout: 10_000 });
    await expect(taggedCount).toBeVisible({ timeout: 10_000 });

    // Rendered count displays only the number, not a fraction
    await expect(renderedCount).toHaveText(`${CLASSIFY_RENDERED}`);
    // Tagged count displays as "tagged / total"
    await expect(taggedCount).toHaveText(`${CLASSIFY_TAGGED} / ${CLASSIFY_TOTAL}`);
  });
});
