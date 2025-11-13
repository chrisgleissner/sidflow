import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const isPlaywrightRunner = Boolean(process.env.PLAYWRIGHT_TEST);

if (!isPlaywrightRunner) {
  console.warn('[sidflow-web] Skipping Playwright tab screenshots e2e spec; run via `bun run test:e2e`.');
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(moduleDir, '../../..', '..', 'doc/web-screenshots');

const PREFERENCES_STORAGE_KEY = 'sidflow.preferences';
const DARK_SCREENSHOT_THEME = 'c64-dark';
const DARK_SCREENSHOT_PREFERENCES = {
  version: 2,
  theme: DARK_SCREENSHOT_THEME,
};

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
test.describe('Tab Screenshots', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(
      ({ key, preferences, theme }) => {
        try {
          window.localStorage.setItem(key, JSON.stringify(preferences));
        } catch (error) {
          console.warn('[screenshots] Failed to seed preferences', error);
        }
        try {
          document.documentElement.setAttribute('data-theme', theme);
          document.documentElement.classList.add('font-mono');
        } catch (error) {
          console.warn('[screenshots] Failed to force theme attribute', error);
        }
      },
      {
        key: PREFERENCES_STORAGE_KEY,
        preferences: DARK_SCREENSHOT_PREFERENCES,
        theme: DARK_SCREENSHOT_THEME,
      }
    );
  });

  const adminTabs = new Set(['wizard', 'fetch', 'rate', 'classify', 'train']);

  for (const tab of TABS) {
    test(`${tab.label} tab screenshot`, async ({ page }) => {
      const basePath = adminTabs.has(tab.value) ? '/admin' : '/';
      await page.goto(`${basePath}?tab=${tab.value}`);
      if (tab.setup) {
        await tab.setup(page);
      }
      await page.waitForFunction(
        (expectedTheme) => document.documentElement.getAttribute('data-theme') === expectedTheme,
        DARK_SCREENSHOT_THEME
      );
      await tab.verify(page);
      await page.screenshot({
        path: path.join(screenshotDir, tab.screenshot),
        fullPage: true,
      });
    });
  }
});
}
