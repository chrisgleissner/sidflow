import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(moduleDir, '../../..', '..', 'doc/web-screenshots');

interface TabScenario {
  label: string;
  screenshot: string;
  setup?: (page: Page) => Promise<void>;
  verify: (page: Page) => Promise<void>;
}

async function activateTab(page: Page, label: string) {
  const tabTrigger = page.getByRole('tab', { name: label });
  await tabTrigger.click();
  await expect(tabTrigger).toHaveAttribute('data-state', 'active');
}

const TABS: TabScenario[] = [
  {
    label: 'WIZARD',
    screenshot: '01-wizard.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /setup wizard/i })).toBeVisible();
    },
  },
  {
    label: 'PREFS',
    screenshot: '02-prefs.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /preferences/i })).toBeVisible();
    },
  },
  {
    label: 'FETCH',
    screenshot: '03-fetch.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /fetch hvsc/i })).toBeVisible();
    },
  },
  {
    label: 'RATE',
    screenshot: '04-rate.png',
    setup: async (page) => {
      await page.locator('#rate-path').fill('/test/hvsc/MUSICIANS/H/Hubbard_Rob/Commando.sid');
    },
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible();
      await expect(page.locator('#rate-path')).toHaveValue(/Commando\.sid$/);
    },
  },
  {
    label: 'CLASSIFY',
    screenshot: '05-classify.png',
    setup: async (page) => {
      await page.locator('#classify-path').fill('/tmp/hvsc');
    },
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /^classify$/i })).toBeVisible();
    },
  },
  {
    label: 'TRAIN',
    screenshot: '06-train.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /train model/i })).toBeVisible();
    },
  },
  {
    label: 'PLAY',
    screenshot: '07-play.png',
    verify: async (page) => {
      await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();
    },
  },
];

test.describe('Tab Screenshots', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  for (const tab of TABS) {
    test(`${tab.label} tab screenshot`, async ({ page }) => {
      await page.goto('/');
      await activateTab(page, tab.label);
      if (tab.setup) {
        await tab.setup(page);
      }
      await tab.verify(page);
      await page.screenshot({
        path: path.join(screenshotDir, tab.screenshot),
        fullPage: true,
      });
    });
  }
});
