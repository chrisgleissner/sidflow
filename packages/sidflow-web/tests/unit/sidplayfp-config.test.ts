import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
      chargenRomPath: '/roms/chargen',
    });

    expect(snapshot.exists).toBe(true);
    expect(snapshot.kernalRomPath).toBe('/roms/kernal');
    expect(snapshot.basicRomPath).toBe('/roms/basic');
    expect(snapshot.chargenRomPath).toBe('/roms/chargen');
    expect(snapshot.contents).toContain('Kernal Rom=/roms/kernal');
    expect(snapshot.contents).toContain('Basic Rom=/roms/basic');
    expect(snapshot.contents).toContain('Chargen Rom=/roms/chargen');

    const readBack = await readSidplayfpConfig();
    expect(readBack.kernalRomPath).toBe('/roms/kernal');
    expect(readBack.basicRomPath).toBe('/roms/basic');
    expect(readBack.chargenRomPath).toBe('/roms/chargen');
  });

  test('removes ROM entry when cleared', async () => {
    await updateSidplayfpConfig({
      kernalRomPath: '/roms/kernal',
      basicRomPath: '/roms/basic',
      chargenRomPath: '/roms/chargen',
    });

    const snapshot = await updateSidplayfpConfig({
      kernalRomPath: null,
    });

    expect(snapshot.kernalRomPath).toBeNull();
    expect(snapshot.basicRomPath).toBe('/roms/basic');
    expect(snapshot.chargenRomPath).toBe('/roms/chargen');
    expect(snapshot.contents).not.toContain('Kernal Rom=');
    expect(snapshot.contents).toContain('Basic Rom=/roms/basic');
    expect(snapshot.contents).toContain('Chargen Rom=/roms/chargen');
  });

  test('readSidplayfpConfig returns empty snapshot when config does not exist', async () => {
    // Use isolated HOME to avoid picking up any system sidplayfp config
    // SIDPLAYFP_CONFIG_PATH is still set to a nonexistent temp path from beforeEach
    const isolatedHome = path.join(tempDir, 'isolated-home');
    await mkdir(isolatedHome, { recursive: true });
    const origHome = process.env.HOME;
    const origXDGConfig = process.env.XDG_CONFIG_HOME;
    const origXDGData = process.env.XDG_DATA_HOME;
    process.env.HOME = isolatedHome;
    process.env.XDG_CONFIG_HOME = path.join(isolatedHome, '.config');
    process.env.XDG_DATA_HOME = path.join(isolatedHome, '.local', 'share');
    try {
      const snapshot = await readSidplayfpConfig();
      expect(snapshot.exists).toBe(false);
      expect(snapshot.contents).toBe('');
      expect(snapshot.kernalRomPath).toBeNull();
      expect(snapshot.basicRomPath).toBeNull();
      expect(snapshot.chargenRomPath).toBeNull();
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (origXDGConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = origXDGConfig;
      if (origXDGData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = origXDGData;
    }
  });

  test('inserts SIDPlayfp section when config has different section', async () => {
    // Write a config with a different section to cover section-not-found insertion path
    await writeFile(
      process.env.SIDPLAYFP_CONFIG_PATH!,
      '[Other]\nfoo=bar\n',
      'utf8',
    );
    const snapshot = await updateSidplayfpConfig({ kernalRomPath: '/roms/kernal' });
    expect(snapshot.kernalRomPath).toBe('/roms/kernal');
    expect(snapshot.contents).toContain('[SIDPlayfp]');
    expect(snapshot.contents).toContain('Kernal Rom=/roms/kernal');
  });

  test('does not modify config when clearing non-existent key in absent section', async () => {
    // Write a config with no SIDPlayfp section, then try to clear a key (null value)
    await writeFile(
      process.env.SIDPLAYFP_CONFIG_PATH!,
      '[Other]\nfoo=bar\n',
      'utf8',
    );
    // kernalRomPath: null + no SIDPlayfp section → setIniValue returns false (no insert for null)
    const snapshot = await updateSidplayfpConfig({ kernalRomPath: null });
    expect(snapshot.kernalRomPath).toBeNull();
    // Section should NOT have been created for null value
    expect(snapshot.contents).not.toContain('[SIDPlayfp]');
  });

  test('inserts key inside existing SIDPlayfp section before next section', async () => {
    // Write a config where SIDPlayfp section exists but our key is missing, followed by another section
    await writeFile(
      process.env.SIDPLAYFP_CONFIG_PATH!,
      '[SIDPlayfp]\nBasic Rom=/roms/basic\n[Other]\nfoo=bar\n',
      'utf8',
    );
    const snapshot = await updateSidplayfpConfig({ kernalRomPath: '/roms/kernal' });
    expect(snapshot.kernalRomPath).toBe('/roms/kernal');
    expect(snapshot.basicRomPath).toBe('/roms/basic');
    // The inserted key should be inside the SIDPlayfp section (before [Other])
    const kernalIndex = snapshot.contents.indexOf('Kernal Rom=');
    const otherIndex = snapshot.contents.indexOf('[Other]');
    expect(kernalIndex).toBeGreaterThan(-1);
    expect(kernalIndex).toBeLessThan(otherIndex);
  });
});
