import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FullConfig } from '@playwright/test';

const AUTH_STATE_PATH = join(process.cwd(), 'test-results', 'e2e', '.auth', 'admin.json');

function ensureAuthStateDirectory() {
  mkdirSync(join(process.cwd(), 'test-results', 'e2e', '.auth'), { recursive: true });
}

export default async function globalSetup(config: FullConfig) {
  ensureAuthStateDirectory();
  writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies: [], origins: [] }, null, 2));

  if (process.env.E2E_COVERAGE === 'true') {
    const nycOutput = join(process.cwd(), '.nyc_output');

    rmSync(nycOutput, { recursive: true, force: true });
    mkdirSync(nycOutput, { recursive: true });

    console.log('[E2E Coverage] ✓ Cleared .nyc_output directory');

    // Verify babel config has istanbul plugin
    const babelrcPath = join(process.cwd(), '.babelrc.json');
    if (existsSync(babelrcPath)) {
      const babelrc = JSON.parse(readFileSync(babelrcPath, 'utf-8'));
      const hasIstanbul = babelrc.plugins?.includes('babel-plugin-istanbul') ||
        babelrc.env?.coverage?.plugins?.includes('babel-plugin-istanbul');
      if (hasIstanbul) {
        console.log('[E2E Coverage] ✓ Babel config has istanbul plugin (env: ' + (process.env.BABEL_ENV || 'default') + ')');
      } else {
        console.warn('[E2E Coverage] ⚠️  WARNING: .babelrc.json does not include babel-plugin-istanbul!');
        console.warn('[E2E Coverage] Current plugins:', babelrc.plugins);
        console.warn('[E2E Coverage] Current env.coverage:', babelrc.env?.coverage);
      }
    } else {
      console.warn('[E2E Coverage] ⚠️  WARNING: .babelrc.json not found!');
    }
  }

}
