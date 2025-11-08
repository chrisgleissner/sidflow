import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readSidplayfpConfig, updateSidplayfpConfig } from '../../lib/sidplayfp-config';

describe('sidplayfp-config helpers', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidplayfp-config-'));
    originalConfigPath = process.env.SIDPLAYFP_CONFIG_PATH;
    process.env.SIDPLAYFP_CONFIG_PATH = path.join(tempDir, 'sidplayfp.ini');
  });

  afterEach(async () => {
    process.env.SIDPLAYFP_CONFIG_PATH = originalConfigPath;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('creates config when saving ROM paths', async () => {
    const snapshot = await updateSidplayfpConfig({
      kernalRomPath: '/roms/kernal',
      basicRomPath: '/roms/basic',
    });

    expect(snapshot.exists).toBe(true);
    expect(snapshot.kernalRomPath).toBe('/roms/kernal');
    expect(snapshot.basicRomPath).toBe('/roms/basic');
    expect(snapshot.contents).toContain('Kernal Rom=/roms/kernal');
    expect(snapshot.contents).toContain('Basic Rom=/roms/basic');

    const readBack = await readSidplayfpConfig();
    expect(readBack.kernalRomPath).toBe('/roms/kernal');
    expect(readBack.basicRomPath).toBe('/roms/basic');
  });

  test('removes ROM entry when cleared', async () => {
    await updateSidplayfpConfig({
      kernalRomPath: '/roms/kernal',
      basicRomPath: '/roms/basic',
    });

    const snapshot = await updateSidplayfpConfig({
      kernalRomPath: null,
    });

    expect(snapshot.kernalRomPath).toBeNull();
    expect(snapshot.basicRomPath).toBe('/roms/basic');
    expect(snapshot.contents).not.toContain('Kernal Rom=');
    expect(snapshot.contents).toContain('Basic Rom=/roms/basic');
  });
});
