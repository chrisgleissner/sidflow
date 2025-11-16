import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SidflowConfig } from '@sidflow/common';

const serverEnvModule = await import('../../lib/server-env');
const { getRepoRoot, getSidflowConfig, resolveConfigPath, resetServerEnvCacheForTests } = serverEnvModule;

describe('server-env config resolution', () => {
    let originalSidflowConfig: string | undefined;

    beforeEach(() => {
        originalSidflowConfig = process.env.SIDFLOW_CONFIG;
        delete process.env.SIDFLOW_CONFIG;
        resetServerEnvCacheForTests();
    });

    afterEach(() => {
        if (originalSidflowConfig === undefined) {
            delete process.env.SIDFLOW_CONFIG;
        } else {
            process.env.SIDFLOW_CONFIG = originalSidflowConfig;
        }
        resetServerEnvCacheForTests();
    });

    test('resolves default config relative to repo root when env var unset', () => {
        const expectedPath = path.resolve(getRepoRoot(), '.sidflow.json');
        expect(resolveConfigPath()).toBe(expectedPath);
    });

    test('uses absolute SIDFLOW_CONFIG path without joining repo root', () => {
        const absoluteConfigPath = path.join(getRepoRoot(), '.sidflow.test.json');
        process.env.SIDFLOW_CONFIG = absoluteConfigPath;

        expect(resolveConfigPath()).toBe(absoluteConfigPath);
    });

    test('trims whitespace from SIDFLOW_CONFIG before resolving', () => {
        const absoluteConfigPath = path.join(getRepoRoot(), 'custom-config.json');
        process.env.SIDFLOW_CONFIG = `  ${absoluteConfigPath}  `;

        expect(resolveConfigPath()).toBe(absoluteConfigPath);
    });

    test('resolves relative SIDFLOW_CONFIG paths under repo root', () => {
        process.env.SIDFLOW_CONFIG = 'config/custom.json';
        const expectedPath = path.resolve(getRepoRoot(), 'config/custom.json');

        expect(resolveConfigPath()).toBe(expectedPath);
    });

    test('loads config from an explicit path argument', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidflow-config-'));
        const tempConfigPath = path.join(tempDir, 'config.json');
        const configPayload: SidflowConfig = {
            hvscPath: tempDir,
            wavCachePath: tempDir,
            tagsPath: tempDir,
            threads: 1,
            classificationDepth: 1,
        };

        await writeFile(tempConfigPath, JSON.stringify(configPayload), 'utf8');

        const config = await getSidflowConfig(tempConfigPath);
        expect(config.hvscPath).toBe(tempDir);
        expect(config.wavCachePath).toBe(tempDir);

        await rm(tempDir, { recursive: true, force: true });
    });
});
