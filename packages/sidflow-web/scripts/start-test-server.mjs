import { createServer } from 'http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, '../../..');
const wasmArtifactPath = resolve(repoRoot, 'packages/libsidplayfp-wasm/dist/libsidplayfp.wasm');

if (!process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH) {
  process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH = wasmArtifactPath;
}

// Provide deterministic defaults for admin authentication during test runs
process.env.SIDFLOW_ADMIN_USER ??= 'ops';
process.env.SIDFLOW_ADMIN_PASSWORD ??= 'test-pass-123';
process.env.SIDFLOW_ADMIN_SECRET ??= 'sidflow-test-secret-456789';
process.env.SIDFLOW_ADMIN_SESSION_TTL_MS ??= `${60 * 60 * 1000}`;

async function start() {
  // Use test-specific config (only set if not already provided)
  if (!process.env.SIDFLOW_CONFIG) {
    // Use repository-root absolute path so nested cwd values don't duplicate segments
    process.env.SIDFLOW_CONFIG = resolve(repoRoot, '.sidflow.test.json');
  }
  console.log('[test-server] Using SIDFLOW_CONFIG=', JSON.stringify(process.env.SIDFLOW_CONFIG));
  try {
    const app = next({
      dev: true,
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
        console.error('Unhandled request error', err);
        res.statusCode = 500;
        res.end('Internal Server Error');
      });
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

    console.log(`Next dev server ready on http://${hostname}:${port}`);
  } catch (error) {
    console.error('Failed to start Next dev server for tests', error);
    process.exit(1);
  }
}

start();
