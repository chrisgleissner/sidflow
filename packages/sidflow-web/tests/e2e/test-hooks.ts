import { test as base, expect, type Page, type BrowserContext, type Locator, type Request, type Route } from '@playwright/test';
import { collectCoverage } from './helpers/collect-coverage';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);
    
    if (process.env.E2E_COVERAGE === 'true') {
      await collectCoverage(page, testInfo.title);
    }
  },
});

export { expect };
export type { Page, BrowserContext, Locator, Request, Route };
