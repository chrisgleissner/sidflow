import { createServer } from 'http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import next from 'next';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, '../../..');
const wasmArtifactPath = resolve(repoRoot, 'packages/libsidplayfp-wasm/dist/libsidplayfp.wasm');
const require = createRequire(import.meta.url);

if (!process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH) {
  process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH = wasmArtifactPath;
}

// Provide deterministic defaults for admin authentication during test runs
process.env.SIDFLOW_ADMIN_USER ??= 'ops';
process.env.SIDFLOW_ADMIN_PASSWORD ??= 'test-pass-123';
process.env.SIDFLOW_ADMIN_SECRET ??= 'sidflow-test-secret-456789';
process.env.SIDFLOW_ADMIN_SESSION_TTL_MS ??= `${60 * 60 * 1000}`;

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const configuredMode = modeArg?.split('=')[1] ?? process.env.SIDFLOW_TEST_SERVER_MODE ?? 'development';
const serverMode = configuredMode.toLowerCase().startsWith('prod') ? 'production' : 'development';
const isProductionMode = serverMode === 'production';
process.env.NODE_ENV = isProductionMode ? 'production' : 'development';

async function runNextBuild() {
  const nodeBinary = process.env.SIDFLOW_NODE_BINARY ?? 'node';
  const nextCli = require.resolve('next/dist/bin/next');
  console.log('[test-server] Building Next.js app for production mode...');

  await new Promise((resolve, reject) => {
    const child = spawn(nodeBinary, [nextCli, 'build'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`next build exited with code ${code ?? -1}`));
      }
    });
  });
}

async function ensureProductionBuild() {
  if (!isProductionMode) {
    return;
  }

  const skipBuild = process.env.SIDFLOW_SKIP_NEXT_BUILD === '1';
  const buildMarker = resolve(process.cwd(), '.next', 'BUILD_ID');

  if (skipBuild && existsSync(buildMarker)) {
    console.warn('[test-server] SIDFLOW_SKIP_NEXT_BUILD=1 — reusing existing Next.js build.');
    return;
  }

  if (skipBuild && !existsSync(buildMarker)) {
    console.warn('[test-server] SIDFLOW_SKIP_NEXT_BUILD=1 but no build output found; running next build.');
  }

  await runNextBuild();
}

const debugRequestErrors = process.env.SIDFLOW_DEBUG_REQUEST_ERRORS === '1';
const suppressAbortLogs = process.env.SIDFLOW_SUPPRESS_ABORT_LOGS !== '0';

function isAbortLike(value) {
  if (!value) {
    return false;
  }
  if (value instanceof Error) {
    const msg = typeof value.message === 'string' ? value.message.toLowerCase() : '';
    return (
      value.code === 'ECONNRESET' ||
      value.code === 'EPIPE' ||
      msg === 'aborted' ||
      msg.includes('error: aborted') ||
      msg.includes('write epipe')
    );
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower.includes('error: aborted') || lower.includes('write epipe');
  }
  if (typeof value === 'object') {
    const maybeCode = value.code;
    const msg = typeof value.message === 'string' ? value.message.toLowerCase() : '';
    return (
      maybeCode === 'ECONNRESET' ||
      maybeCode === 'EPIPE' ||
      msg === 'aborted' ||
      msg.includes('error: aborted') ||
      msg.includes('write epipe')
    );
  }
  return false;
}

if (suppressAbortLogs) {
  const originalConsoleError = console.error;
  console.error = (...args) => {
    if (args.some((arg) => isAbortLike(arg))) {
      if (debugRequestErrors) {
        originalConsoleError('[test-server] suppressed abort log', ...args);
      }
      return;
    }
    originalConsoleError(...args);
  };
}

async function start() {
  // Use test-specific config (only set if not already provided)
  if (!process.env.SIDFLOW_CONFIG) {
    // Use repository-root absolute path so nested cwd values don't duplicate segments
    process.env.SIDFLOW_CONFIG = resolve(repoRoot, '.sidflow.test.json');
  }
  console.log('[test-server] Using SIDFLOW_CONFIG=', JSON.stringify(process.env.SIDFLOW_CONFIG));
  console.log(`[test-server] Mode=${serverMode} pid=${process.pid}`);
  try {
    if (isProductionMode) {
      await ensureProductionBuild();
    }

    const app = next({
      dev: !isProductionMode,
      hostname,
      port,
      dir: process.cwd(),
    });
    const handle = app.getRequestHandler();

    await app.prepare();

    const closeApp = async () => {
      if (typeof app.close === 'function') {
        try {
          await app.close();
        } catch (err) {
          console.error('Error while closing Next app', err);
        }
      }
    };

    const server = createServer((req, res) => {
      handle(req, res).catch((err) => {
        const code = err?.code;
        const message = typeof err?.message === 'string' ? err.message : '';
        const isAbort = isAbortLike(err);
        if (debugRequestErrors) {
          console.error('[test-server] request error', {
            code,
            name: err?.name,
            message,
            stack: err?.stack,
          });
        }
        if (isAbort) {
          // Client navigated away before Next.js finished responding; ignore to avoid noisy logs.
          if (!res.writableEnded) {
            res.destroy();
          }
          return;
        }
        console.error('Unhandled request error', err);
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        if (!res.writableEnded) {
          res.end('Internal Server Error');
        }
      });
    });

    server.on('clientError', (err, socket) => {
      if (err?.code === 'ECONNRESET' || err?.code === 'EPIPE') {
        socket.destroy();
        return;
      }
      console.error('[test-server] clientError', err);
      socket.destroy();
    });

    const shutdown = (signal) => {
      console.log(`Received ${signal}, shutting down Next dev server`);
      server.close(async () => {
        await closeApp();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('error', onError);
        reject(err);
      };
      server.on('error', onError);
      server.listen(port, hostname, () => {
        server.off('error', onError);
        resolve();
      });
    });

    console.log(`Next ${isProductionMode ? 'production' : 'dev'} server ready on http://${hostname}:${port}`);
  } catch (error) {
    console.error('Failed to start Next test server', error);
    process.exit(1);
  }
}

start();
