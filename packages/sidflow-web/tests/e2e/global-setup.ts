import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
  const nycOutput = join(process.cwd(), '.nyc_output');
  
  rmSync(nycOutput, { recursive: true, force: true });
  mkdirSync(nycOutput, { recursive: true });
  
  console.log('[E2E Coverage] Cleared .nyc_output directory');
}
