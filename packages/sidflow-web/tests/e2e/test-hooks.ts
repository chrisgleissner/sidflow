import { test as base, expect, type Page, type BrowserContext, type Locator, type Request, type Route } from '@playwright/test';
import { collectCoverage } from './helpers/collect-coverage';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_PATH,
  encodeSessionPayload,
  getAdminConfig,
} from '@/lib/server/admin-auth-core';

async function seedAdminSessionCookie(page: Page) {
  const serverMode = (process.env.SIDFLOW_E2E_SERVER_MODE ?? 'production').toLowerCase();
  if (!serverMode.startsWith('prod')) {
    return;
  }

  const baseUrl = process.env.SIDFLOW_E2E_BASE_URL ?? 'http://127.0.0.1:3000';
  const targetUrl = new URL(baseUrl);
  const now = Date.now();
  const config = getAdminConfig();
  const token = await encodeSessionPayload({
    v: 1,
    role: 'admin',
    issuedAt: now,
    expiresAt: now + config.sessionTtlMs,
  }, config.secret);

  await page.context().addCookies([
    {
      name: ADMIN_SESSION_COOKIE,
      value: token,
      domain: targetUrl.hostname,
      path: ADMIN_SESSION_COOKIE_PATH,
      expires: Math.floor((now + config.sessionTtlMs) / 1000),
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
    },
  ]);
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await seedAdminSessionCookie(page);
    await use(page);
    
    if (process.env.E2E_COVERAGE === 'true') {
      await collectCoverage(page, testInfo.title);
    }
  },
});

export { expect };
export type { Page, BrowserContext, Locator, Request, Route };
