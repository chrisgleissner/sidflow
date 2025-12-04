# Test Coverage Guide

**Current Status**: 65.89% (11,929/18,105 lines)  
**Target**: >90%  
**Established**: 2025-11-20 (first automated measurement via Codecov in PR #46)

## Coverage by Package

| Package | Coverage | Gap to 90% |
|---------|----------|------------|
| sidflow-play | 93.01% ✅ | None |
| sidflow-train | 92.54% ✅ | None |
| sidflow-rate | 90.43% ✅ | None |
| sidflow-fetch | 88.14% | 53 lines |
| sidflow-classify | 72.97% | 614 lines |
| sidflow-web | 54.51% | 2,874 lines |
| sidflow-common | 45.87% | 3,611 lines |
| libsidplayfp-wasm | 35.90% | 553 lines |

## Priority Improvement Areas

### Phase 1: Server-Side Unit Tests (+8% coverage)
- `audio-encoding.ts` (382 uncovered lines)
- `playback-harness.ts` (296 lines)
- `job-runner.ts` (206 lines)
- `recommender.ts` (195 lines)

### Phase 2: CLI Testing (+4% coverage)
- `render/cli.ts` (416 lines)
- `classify/cli.ts` (273 lines)
- `fetch/sync.ts` (210 lines)

### Phase 3: Browser Code (+6% coverage)
- `sidflow-player.ts` (568 lines) - needs Web Audio API mocks
- `worklet-player.ts` (523 lines) - needs AudioWorklet mocks
- `feedback/storage.ts` (402 lines) - needs IndexedDB mocks

## Intentionally Excluded Code

Files marked `/* c8 ignore file */` require external dependencies:
- Playback harness (requires ffplay/aplay)
- Ultimate64 client (requires hardware)
- WASM player wrappers (requires browser + WASM)

## Running Coverage

```bash
bun run test --coverage
```

## Codecov Configuration

- Baseline: 65.89%
- Patch requirement: 80% for new code
- Threshold: 2% decrease allowed while stabilizing
