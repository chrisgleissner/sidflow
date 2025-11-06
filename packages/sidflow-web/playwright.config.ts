import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const stubBinDir = path.resolve(__dirname, 'tests/stubs');
const defaultSystemPath = [
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
].join(path.delimiter);
const existingPath =
  process.env.PLAYWRIGHT_ORIGINAL_PATH ||
  process.env.PATH ||
  process.env.Path ||
  defaultSystemPath;
const webServerPath = [stubBinDir, existingPath].filter(Boolean).join(path.delimiter);

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      ...process.env,
      // Add stub CLI tools to PATH for testing while preserving system binaries.
      PATH: webServerPath,
    },
  },
});
