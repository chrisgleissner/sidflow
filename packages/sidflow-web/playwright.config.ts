import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

process.env.NEXT_PUBLIC_SIDFLOW_FAST_AUDIO_TESTS ??= '1';

const configDir = path.dirname(fileURLToPath(import.meta.url));
process.env.SIDFLOW_SKIP_SONGBROWSER_ACTIONS ??= '1';
const stubToolsPath = path.resolve(configDir, 'tests/stubs');
const repoRoot = path.resolve(configDir, '..', '..');
const defaultModelPath = path.resolve(repoRoot, 'data', 'model');
const testConfigPath = path.resolve(repoRoot, '.sidflow.test.json');

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
  httpCredentials: {
    username: process.env.SIDFLOW_ADMIN_USER ?? 'ops',
    password: process.env.SIDFLOW_ADMIN_PASSWORD ?? 'test-pass-123',
  },
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

const requestedServerMode = process.env.SIDFLOW_E2E_SERVER_MODE ?? 'production';
const normalizedServerMode = requestedServerMode.toLowerCase().startsWith('prod') ? 'production' : 'development';
const serverNodeEnv = normalizedServerMode === 'production' ? 'production' : 'development';
const webServerTimeout = normalizedServerMode === 'production' ? 240 * 1000 : 180 * 1000;
const skipNextBuildFlag = process.env.SIDFLOW_SKIP_NEXT_BUILD ?? '1';
const serverNodeOptions = process.env.SIDFLOW_WEB_SERVER_NODE_OPTIONS;
const defaultWorkers = process.env.CI ? 3 : 3;
const parsedWorkers = Number(process.env.SIDFLOW_E2E_WORKERS ?? defaultWorkers);
const resolvedWorkers =
  Number.isFinite(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : defaultWorkers;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: resolvedWorkers,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/report.json' }],
  ],
  use: baseUse,

  projects: [
    {
      name: 'chromium',
      testIgnore: /(favorites|phase1-features|song-browser)\.spec\.ts$/,
      use: { ...projectUse },
    },
    {
      name: 'chromium-favorites',
      testMatch: /favorites\.spec\.ts$/,
      workers: 1,
      use: { ...projectUse },
    },
    {
      name: 'chromium-phase1',
      testMatch: /phase1-features\.spec\.ts$/,
      workers: 1,
      dependencies: ['chromium'],
      use: { ...projectUse },
    },
    {
      name: 'chromium-song-browser',
      testMatch: /song-browser\.spec\.ts$/,
      workers: 1,
      dependencies: ['chromium'],
      use: { ...projectUse },
    },
  ],

  webServer: {
    command: 'bun ./scripts/setup-test-workspace.mjs && bun run build:worklet && node ./scripts/start-test-server.mjs',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: webServerTimeout,
    env: {
      // Add stub CLI tools to PATH for testing
      PATH: `${stubToolsPath}${path.delimiter}${process.env.PATH ?? ''}`,
      NODE_ENV: serverNodeEnv,
      HOSTNAME: '0.0.0.0',
      SIDFLOW_CONFIG: testConfigPath,
      SIDFLOW_MODEL_PATH: process.env.SIDFLOW_MODEL_PATH ?? defaultModelPath,
      SIDFLOW_TEST_SERVER_MODE: normalizedServerMode,
      ...(normalizedServerMode === 'production'
        ? { SIDFLOW_DISABLE_RENDER: '1', SIDFLOW_RELAXED_CSP: '1' }
        : {}),
      SIDFLOW_FAVORITES_CACHE_TTL_MS: '0',
      SIDFLOW_LOG_FAVORITES: process.env.SIDFLOW_LOG_FAVORITES ?? '1',
      SIDFLOW_LOG_SEARCH: process.env.SIDFLOW_LOG_SEARCH ?? '1',
      SIDFLOW_SKIP_SONGBROWSER_ACTIONS: process.env.SIDFLOW_SKIP_SONGBROWSER_ACTIONS ?? '1',
      NEXT_PUBLIC_SIDFLOW_FAST_AUDIO_TESTS: process.env.NEXT_PUBLIC_SIDFLOW_FAST_AUDIO_TESTS ?? '1',
      ...(serverNodeOptions ? { NODE_OPTIONS: serverNodeOptions } : {}),
      ...(skipNextBuildFlag ? { SIDFLOW_SKIP_NEXT_BUILD: skipNextBuildFlag } : {}),
    },
  },
});
