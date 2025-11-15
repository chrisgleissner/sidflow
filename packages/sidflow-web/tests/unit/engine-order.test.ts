import { describe, it, expect } from 'bun:test';
import type { RenderEngine } from '@sidflow/common';

// This is a simplified version of the resolveEngineOrder logic from the admin render route
function resolveEngineOrder(
  selection: RenderEngine | "auto" | undefined,
  preferred: RenderEngine[],
  configPreferred?: RenderEngine[]
): RenderEngine[] {
  const ordered: RenderEngine[] = [];
  const append = (engine: RenderEngine | null | undefined) => {
    if (engine && !ordered.includes(engine)) {
      ordered.push(engine);
    }
  };

  if (selection && selection !== "auto") {
    append(selection);
  }
  for (const engine of preferred) {
    append(engine);
  }
  if (configPreferred) {
    for (const engine of configPreferred) {
      append(engine);
    }
  }
  append("wasm");
  return ordered;
}

describe('resolveEngineOrder', () => {
  it('should use forced engine first, then append wasm', () => {
    const result = resolveEngineOrder('sidplayfp-cli', [], undefined);
    expect(result).toEqual(['sidplayfp-cli', 'wasm']);
  });

  it('should respect preferred engines and append wasm', () => {
    const result = resolveEngineOrder(undefined, ['ultimate64', 'sidplayfp-cli'], undefined);
    expect(result).toEqual(['ultimate64', 'sidplayfp-cli', 'wasm']);
  });

  it('should use config preferred when no request preferred', () => {
    const result = resolveEngineOrder(undefined, [], ['sidplayfp-cli', 'ultimate64']);
    expect(result).toEqual(['sidplayfp-cli', 'ultimate64', 'wasm']);
  });

  it('should merge request preferred and config preferred without duplicates', () => {
    const result = resolveEngineOrder(
      undefined,
      ['ultimate64'],
      ['ultimate64', 'sidplayfp-cli']
    );
    expect(result).toEqual(['ultimate64', 'sidplayfp-cli', 'wasm']);
  });

  it('should prioritize forced engine over all preferences', () => {
    const result = resolveEngineOrder(
      'wasm',
      ['ultimate64'],
      ['sidplayfp-cli']
    );
    // Forced engine comes first, but preferences are still added as fallbacks
    expect(result).toEqual(['wasm', 'ultimate64', 'sidplayfp-cli']);
  });

  it('should handle auto mode as no forced engine', () => {
    const result = resolveEngineOrder('auto', ['ultimate64'], undefined);
    expect(result).toEqual(['ultimate64', 'wasm']);
  });

  it('should always append wasm even if already in preferences', () => {
    const result = resolveEngineOrder(undefined, ['wasm', 'sidplayfp-cli'], undefined);
    expect(result).toEqual(['wasm', 'sidplayfp-cli']);
  });

  it('should handle empty preferences gracefully', () => {
    const result = resolveEngineOrder(undefined, [], undefined);
    expect(result).toEqual(['wasm']);
  });

  it('should deduplicate engines across all sources', () => {
    const result = resolveEngineOrder(
      'sidplayfp-cli',
      ['sidplayfp-cli', 'ultimate64'],
      ['ultimate64', 'wasm']
    );
    expect(result).toEqual(['sidplayfp-cli', 'ultimate64', 'wasm']);
  });
});
