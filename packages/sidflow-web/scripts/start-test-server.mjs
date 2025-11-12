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

async function start() {
  // Use test-specific config
  process.env.SIDFLOW_CONFIG = '.sidflow.test.json';
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
