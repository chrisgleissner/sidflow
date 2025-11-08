import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const stubToolsPath = path.resolve(configDir, 'tests/stubs');

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const chromeExecutable = process.env.PLAYWRIGHT_CHROME_PATH;
const hasSystemChrome = Boolean(chromeExecutable && existsSync(chromeExecutable));

const videoMode: 'on' | 'off' | 'retain-on-failure' = process.env.CI ? 'retain-on-failure' : 'on';

const baseUse = {
  baseURL: 'http://localhost:3000',
  trace: 'on-first-retry' as const,
  headless: true,
  video: videoMode,
};

const desktopChrome = devices['Desktop Chrome'];

function sanitizeDevice(device: typeof desktopChrome): typeof desktopChrome {
  const cloned = { ...device } as Record<string, unknown>;
  delete cloned.channel;
  return cloned as typeof desktopChrome;
}

const projectDevice = hasSystemChrome ? sanitizeDevice(desktopChrome) : desktopChrome;

const projectUse = hasSystemChrome
  ? { ...projectDevice, executablePath: chromeExecutable }
  : projectDevice;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 10 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/report.json' }],
  ],
  use: baseUse,

  projects: [
    {
      name: 'chromium',
      use: { ...projectUse },
    },
  ],

  webServer: {
    command: 'bun ./scripts/start-test-server.mjs',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
    env: {
      // Add stub CLI tools to PATH for testing
      PATH: `${stubToolsPath}${path.delimiter}${process.env.PATH ?? ''}`,
      NODE_ENV: 'development',
      HOSTNAME: '0.0.0.0',
    },
  },
});
