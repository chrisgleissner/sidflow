import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

process.env.NEXT_PUBLIC_SIDFLOW_FAST_AUDIO_TESTS ??= '1';
process.env.SIDFLOW_SKIP_SONGBROWSER_ACTIONS ??= '1';
process.env.SIDFLOW_ADMIN_SECRET ??= 'sidflow-test-pass-123';

const configDir = path.dirname(fileURLToPath(import.meta.url));
process.env.SIDFLOW_SKIP_SONGBROWSER_ACTIONS ??= '1';
const stubToolsPath = path.resolve(configDir, 'tests/stubs');
const repoRoot = path.resolve(configDir, '..', '..');
const defaultModelPath = path.resolve(repoRoot, 'data', 'model');
const testConfigPath = path.resolve(repoRoot, '.sidflow.test.json');
const defaultBaseUrl = process.env.SIDFLOW_E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const parsedBaseUrl = (() => {
  try {
    return new URL(defaultBaseUrl);
  } catch {
    return null;
  }
})();
const webServerHost = process.env.SIDFLOW_E2E_HOST ?? parsedBaseUrl?.hostname ?? '127.0.0.1';
const webServerPort = process.env.SIDFLOW_E2E_PORT ?? parsedBaseUrl?.port ?? '3000';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const defaultSystemChromePath = '/usr/bin/google-chrome';
const chromeExecutable =
  process.env.PLAYWRIGHT_CHROME_PATH ??
  (existsSync(defaultSystemChromePath) ? defaultSystemChromePath : undefined);
const hasSystemChrome = Boolean(chromeExecutable && existsSync(chromeExecutable));

if (process.env.SIDFLOW_DEBUG_PW_CONFIG === '1') {
  // eslint-disable-next-line no-console
  console.log('[playwright-config]', { chromeExecutable, hasSystemChrome });
}

// Video recording requires Playwright-managed ffmpeg downloads. Prefer "off" by default to keep
// CI and local agent runs fast and dependency-free (system Chrome is used when available).
const wantVideo = process.env.SIDFLOW_E2E_VIDEO === '1';
const videoMode: 'on' | 'off' | 'retain-on-failure' = wantVideo
  ? process.env.CI
    ? 'retain-on-failure'
    : 'on'
  : 'off';

const baseUse = {
  baseURL: defaultBaseUrl,
  trace: 'on-first-retry' as const,
  headless: true,
  video: videoMode,
  // CI is slower - increase navigation timeout from default 30s to 60s
  navigationTimeout: 60_000,
  // Also increase action timeout to 30s for slower CI environments
  actionTimeout: 30_000,
  launchOptions: {
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--enable-features=SharedArrayBuffer',
    ],
  },
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
  ? {
      ...projectDevice,
      launchOptions: {
        ...(() => {
          const value = (projectDevice as unknown as { launchOptions?: unknown }).launchOptions;
          return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
        })(),
        executablePath: chromeExecutable,
      },
    }
  : projectDevice;

const requestedServerMode = process.env.SIDFLOW_E2E_SERVER_MODE ?? 'production';
const normalizedServerMode = requestedServerMode.toLowerCase().startsWith('prod') ? 'production' : 'development';
const serverNodeEnv = normalizedServerMode === 'production' ? 'production' : 'development';
const webServerTimeout = normalizedServerMode === 'production' ? 240 * 1000 : 180 * 1000;
const skipNextBuildFlag = process.env.SIDFLOW_SKIP_NEXT_BUILD ?? '1';
const serverNodeOptions = process.env.SIDFLOW_WEB_SERVER_NODE_OPTIONS;
// CI optimization: 4 workers provides good balance between parallelism and resource contention
// GitHub Actions runners have 2 cores but can handle 4 workers efficiently for I/O-bound tests
const defaultWorkers = process.env.CI ? 4 : 3;
const parsedWorkers = Number(process.env.SIDFLOW_E2E_WORKERS ?? defaultWorkers);
const resolvedWorkers =
  Number.isFinite(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : defaultWorkers;

const includePerformanceSpecs = process.env.SIDFLOW_E2E_INCLUDE_PERF === '1';
const chromiumTestIgnore = includePerformanceSpecs
  ? /(favorites|phase1-features|song-browser)\.spec\.ts$/
  : /(favorites|phase1-features|song-browser|performance)\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',
  // Increase from 45s to 90s - audio playback tests need more time in CI
  timeout: 90 * 1000,
  // Expect timeout for assertions (default 5s is often too short in CI)
  expect: {
    timeout: 15_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: resolvedWorkers,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // Enable code coverage collection
  testMatch: /.*\.spec\.ts$/,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/report.json' }],
    // E2E coverage is opt-in (see `npm run coverage:e2e`). Avoid noisy "no coverage" logs on normal runs.
    ...(process.env.E2E_COVERAGE === 'true' ? ([['./tests/e2e/coverage-reporter.ts']] as const) : []),
  ],
  use: baseUse,

  projects: [
    {
      name: 'chromium',
      testIgnore: chromiumTestIgnore,
      use: { ...projectUse },
      // Enable JS coverage for this project
      metadata: { coverage: true },
    },
    {
      name: 'chromium-favorites',
      testMatch: /favorites\.spec\.ts$/,
      workers: 1,
      use: { ...projectUse },
      metadata: { coverage: true },
    },
    {
      name: 'chromium-phase1',
      testMatch: /phase1-features\.spec\.ts$/,
      workers: 1,
      use: { ...projectUse },
      metadata: { coverage: true },
    },
    {
      name: 'chromium-song-browser',
      testMatch: /song-browser\.spec\.ts$/,
      workers: 1,
      use: { ...projectUse },
      metadata: { coverage: true },
    },
  ],

  webServer: {
    command: 'bun ./scripts/setup-test-workspace.mjs && bun run build:worklet && node ./scripts/start-test-server.mjs',
    url: defaultBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: webServerTimeout,
    env: {
      // Add stub CLI tools to PATH for testing
      PATH: (() => {
        const home = process.env.HOME;
        const bunBin = home ? path.join(home, '.bun', 'bin') : null;
        const bunSegment = bunBin && existsSync(bunBin) ? `${bunBin}${path.delimiter}` : '';
        return `${stubToolsPath}${path.delimiter}${bunSegment}${process.env.PATH ?? ''}`;
      })(),
      NODE_ENV: serverNodeEnv,
      HOSTNAME: webServerHost,
      PORT: webServerPort,
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
      // Skip build flag - but force rebuild when E2E_COVERAGE is enabled
      ...(skipNextBuildFlag && process.env.E2E_COVERAGE !== 'true' ? { SIDFLOW_SKIP_NEXT_BUILD: skipNextBuildFlag } : {}),
      // Pass E2E_COVERAGE to enable instrumentation
      ...(process.env.E2E_COVERAGE === 'true' ? { E2E_COVERAGE: 'true', BABEL_ENV: 'coverage' } : {}),
      // Pass admin credentials to server so middleware can validate them
      SIDFLOW_ADMIN_USER: process.env.SIDFLOW_ADMIN_USER ?? 'ops',
      SIDFLOW_ADMIN_PASSWORD: process.env.SIDFLOW_ADMIN_PASSWORD ?? 'test-pass-123',
      SIDFLOW_ADMIN_SECRET: process.env.SIDFLOW_ADMIN_SECRET ?? 'sidflow-test-pass-123',
      SIDFLOW_DISABLE_ADMIN_AUTH: '1',
    },
  },
});
