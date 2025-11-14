import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { RenderTechnology } from '@sidflow/common';

// Mock implementation of web preferences for testing
interface WebPreferences {
  sidBasePath?: string | null;
  kernalRomPath?: string | null;
  basicRomPath?: string | null;
  chargenRomPath?: string | null;
  sidplayfpCliFlags?: string | null;
  renderEngine?: RenderTechnology;
  preferredEngines?: RenderTechnology[] | null;
}

const DEFAULT_PREFERENCES: WebPreferences = {
  sidBasePath: null,
  kernalRomPath: null,
  basicRomPath: null,
  chargenRomPath: null,
  sidplayfpCliFlags: null,
  renderEngine: 'wasm',
  preferredEngines: null,
};

describe('WebPreferences Schema', () => {
  it('should have default preferredEngines as null', () => {
    expect(DEFAULT_PREFERENCES.preferredEngines).toBeNull();
  });

  it('should accept valid renderEngine values', () => {
    const engines: RenderTechnology[] = ['wasm', 'sidplayfp-cli', 'ultimate64'];
    engines.forEach(engine => {
      const prefs: WebPreferences = { ...DEFAULT_PREFERENCES, renderEngine: engine };
      expect(prefs.renderEngine).toBe(engine);
    });
  });

  it('should accept valid preferredEngines array', () => {
    const preferred: RenderTechnology[] = ['sidplayfp-cli', 'ultimate64', 'wasm'];
    const prefs: WebPreferences = { ...DEFAULT_PREFERENCES, preferredEngines: preferred };
    expect(prefs.preferredEngines).toEqual(preferred);
  });

  it('should accept null preferredEngines', () => {
    const prefs: WebPreferences = { ...DEFAULT_PREFERENCES, preferredEngines: null };
    expect(prefs.preferredEngines).toBeNull();
  });

  it('should allow empty preferredEngines array', () => {
    const prefs: WebPreferences = { ...DEFAULT_PREFERENCES, preferredEngines: [] };
    expect(prefs.preferredEngines).toEqual([]);
  });

  it('should allow deduplication of preferred engines', () => {
    const preferred: RenderTechnology[] = ['wasm', 'wasm', 'sidplayfp-cli'];
    const deduped: RenderTechnology[] = [...new Set(preferred)];
    const prefs: WebPreferences = { ...DEFAULT_PREFERENCES, preferredEngines: deduped };
    expect(prefs.preferredEngines).toEqual(['wasm', 'sidplayfp-cli']);
  });
});

describe('Preference Merging Logic', () => {
  it('should merge user preferences over config preferences', () => {
    const userPreferred: RenderTechnology[] = ['ultimate64'];
    const configPreferred: RenderTechnology[] = ['sidplayfp-cli', 'wasm'];
    
    // User preferences should come first
    const merged: RenderTechnology[] = [];
    const seen = new Set<RenderTechnology>();
    
    for (const engine of userPreferred) {
      if (!seen.has(engine)) {
        seen.add(engine);
        merged.push(engine);
      }
    }
    for (const engine of configPreferred) {
      if (!seen.has(engine)) {
        seen.add(engine);
        merged.push(engine);
      }
    }
    
    expect(merged).toEqual(['ultimate64', 'sidplayfp-cli', 'wasm']);
  });

  it('should always append wasm if not present', () => {
    const preferred: RenderTechnology[] = ['sidplayfp-cli', 'ultimate64'];
    if (!preferred.includes('wasm')) {
      preferred.push('wasm');
    }
    expect(preferred).toEqual(['sidplayfp-cli', 'ultimate64', 'wasm']);
  });
});
