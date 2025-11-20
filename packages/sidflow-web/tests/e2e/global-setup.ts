import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
  if (process.env.E2E_COVERAGE === 'true') {
    const nycOutput = join(process.cwd(), '.nyc_output');
    
    rmSync(nycOutput, { recursive: true, force: true });
    mkdirSync(nycOutput, { recursive: true });
    
    console.log('[E2E Coverage] ✓ Cleared .nyc_output directory');
    
    // Verify babel config has istanbul plugin
    const babelrcPath = join(process.cwd(), '.babelrc.json');
    if (existsSync(babelrcPath)) {
      const babelrc = JSON.parse(readFileSync(babelrcPath, 'utf-8'));
      const hasIstanbul = babelrc.plugins?.includes('babel-plugin-istanbul');
      if (hasIstanbul) {
        console.log('[E2E Coverage] ✓ Babel config has istanbul plugin');
      } else {
        console.warn('[E2E Coverage] ⚠️  WARNING: .babelrc.json does not include babel-plugin-istanbul!');
        console.warn('[E2E Coverage] Current plugins:', babelrc.plugins);
      }
    } else {
      console.warn('[E2E Coverage] ⚠️  WARNING: .babelrc.json not found!');
    }
  }
}
