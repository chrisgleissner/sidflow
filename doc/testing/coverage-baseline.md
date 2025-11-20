# Coverage Baseline Report

**Date**: 2025-11-20  
**Commit**: PR #46 merge (eccdf08)  
**Overall Coverage**: 65.89% (11,929/18,105 lines)

**Note**: Coverage excludes `dist/` folders which contain transpiled build artifacts. Including dist/ would show 56.45% (12,830/22,727 lines) but this double-counts source files.

## Context

This is the **first automated coverage measurement** for the SIDFlow project. Codecov integration was added in PR #46 (2025-11-20). Previous references to "90%" coverage were documentation goals, not actual measurements.

**Root Cause**: PR #46 added approximately 17,000 lines of source code along with comprehensive E2E tests but with incomplete unit test coverage for new functionality.

## Coverage by Package

| Package | Coverage | Lines Hit | Total Lines | Gap to 90% |
|---------|----------|-----------|-------------|------------|
| sidflow-play | 93.01% ✅ | 825 | 887 | None |
| sidflow-train | 92.54% ✅ | 360 | 389 | None |
| sidflow-rate | 90.43% ✅ | 85 | 94 | None |
| sidflow-fetch | 88.14% | 394 | 447 | 53 lines |
| sidflow-classify | 72.97% | 2,629 | 3,603 | 614 lines |
| sidflow-web | 54.51% | 4,417 | 8,103 | 2,874 lines |
| sidflow-common | 45.87% | 3,752 | 8,179 | 3,611 lines |
| libsidplayfp-wasm | 35.90% | 368 | 1,025 | 553 lines |
| **TOTAL** | **65.89%** | **11,929** | **18,105** | **4,375 lines** |

## Top Priority Files for Coverage Improvement

Files with >400 uncovered lines (highest ROI for unit tests):

1. **packages/sidflow-web/lib/player/sidflow-player.ts**
   - Coverage: 24.8% (187/755 lines)
   - Uncovered: 568 lines
   - Type: Browser audio player implementation
   - Test Strategy: Unit tests with Web Audio API mocks + E2E coverage

2. **packages/sidflow-web/lib/audio/worklet-player.ts**
   - Coverage: 23.3% (159/682 lines)
   - Uncovered: 523 lines
   - Type: Audio Worklet player implementation
   - Test Strategy: Unit tests with AudioWorklet mocks

3. **packages/sidflow-classify/src/render/cli.ts**
   - Coverage: 36.4% (238/654 lines)
   - Uncovered: 416 lines
   - Type: CLI rendering orchestration
   - Test Strategy: CLI unit tests with mocked subprocesses

5. **packages/sidflow-web/lib/feedback/storage.ts**
   - Coverage: 16.6% (80/482 lines)
   - Uncovered: 402 lines
   - Type: Browser storage for user feedback
   - Test Strategy: Unit tests with IndexedDB/localStorage mocks

6. **packages/sidflow-common/src/audio-encoding.ts**
   - Coverage: 27.8% (147/529 lines)
   - Uncovered: 382 lines
   - Type: Audio encoding/transcoding utilities
   - Test Strategy: Unit tests with FFmpeg mocks

## Improvement Strategy

### Phase 1: Server-Side Unit Tests (Target: +20% coverage)

Focus on testable, non-browser code in sidflow-common:
- audio-encoding.ts (382 lines)
- playback-harness.ts (296 lines)
- job-runner.ts (206 lines)
- recommender.ts (195 lines)
- lancedb-builder.ts (178 lines)

**Estimated Impact**: +2,000 lines = 8.8% total coverage increase

### Phase 2: CLI Testing Infrastructure (Target: +10% coverage)

Add CLI test harness and mock infrastructure:
- render/cli.ts (416 lines)
- classify/cli.ts (273 lines)
- fetch/sync.ts (210 lines)

**Estimated Impact**: +900 lines = 4.0% total coverage increase

### Phase 3: Browser Code Strategy (Target: +8% coverage)

Decision needed on browser-only code:
- **Option A**: Add E2E coverage collection via Playwright
- **Option B**: Extensive mocking for unit tests
- **Option C**: Accept lower coverage for browser-only code

**Estimated Impact**: +1,500 lines = 6.6% total coverage increase (if pursuing unit tests)

### Phase 4: Integration Code Acceptance

Some code may remain below 90% by design:
- WASM player wrappers (requires browser + WASM)
- Ultimate64 hardware interfaces (requires actual hardware)
- Complex rendering pipelines (requires full audio stack)

## Codecov Configuration

Updated `.codecov.yml` to:
- Accept current 56.45% baseline
- Require 80% coverage for new patches (working toward 90%)
- Allow 2% threshold decrease while stabilizing
- Set informational mode OFF to enforce checks

## Timeline

- **2025-11-20**: Initial baseline established
- **Target Q1 2026**: Achieve 75% overall coverage
- **Target Q2 2026**: Achieve 90% overall coverage

## References

- [Coverage Improvement Plan](./coverage-improvement-plan.md)
- [E2E Test Resilience Guide](./e2e-test-resilience-guide.md)
- [Codecov Configuration](./.codecov.yml)
