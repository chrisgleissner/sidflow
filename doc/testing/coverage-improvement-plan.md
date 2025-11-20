# Test Coverage Improvement Plan

**Current Status**: 68.55% coverage (as of 2025-11-20)
**Target**: >90% coverage
**Gap**: 21.45% improvement needed

## Executive Summary

Achieving >90% test coverage requires systematic addition of unit tests for:
1. CLI modules (currently 52-84%)
2. Browser-only code (currently 0-9%)  
3. Rendering infrastructure (currently 62-82%)
4. Integration points requiring external dependencies

**Estimated effort**: 8-12 hours of focused test writing

## Coverage Gaps by Priority

### Priority 1: High-Impact, Testable Code (6-8 hours)

#### 1.1 CLI Modules (52-84% → 90%)
Files:
- `packages/sidflow-classify/src/cli.ts` (84%)
- `packages/sidflow-fetch/src/cli.ts` (83%)
- `packages/sidflow-train/src/cli.ts` (80%)
- `packages/sidflow-play/src/cli.ts` (53%)

Approach:
```typescript
// Mock process.argv, stdin, stdout
import { mock } from 'bun:test';
const mockStdout = mock(() => {});
const mockStderr = mock(() => {});
// Test argument parsing, help text, error handling
```

Testing focus:
- Argument validation
- Help text generation
- Error handling paths
- Exit code behavior
- Progress callback invocation

#### 1.2 Audio Encoding (53% → 90%)
File: `packages/sidflow-common/src/audio-encoding.ts`

Current limitation: Tests skip when ffmpeg unavailable

Solution:
- Add mocks for ffmpeg spawn calls
- Test error handling without requiring ffmpeg
- Test format validation and parameter passing
- Keep existing integration tests for when ffmpeg is available

#### 1.3 Rendering Infrastructure (62-82% → 90%)
Files:
- `packages/sidflow-classify/src/render/cli.ts` (63%)
- `packages/sidflow-classify/src/render/engine-factory.ts` (75%)
- `packages/sidflow-classify/src/render/render-orchestrator.ts` (71%)
- `packages/sidflow-classify/src/render/wasm-render-pool.ts` (82%)

Approach:
- Mock WASM engine creation
- Test pool management logic
- Test orchestration state machines
- Test error recovery paths

### Priority 2: Browser-Only Code (0-9% → 70%) (2-3 hours)

Files needing browser environment or E2E coverage:
- `packages/sidflow-web/lib/server/cache.ts` (9%)
- `packages/sidflow-web/lib/server/similarity-search.ts` (0%)
- `packages/sidflow-web/lib/telemetry.ts` (0%)
- `packages/sidflow-web/lib/sid-collection.ts` (0%)

Options:
1. **jsdom approach**: Mock browser globals, test logic separately
2. **E2E coverage**: Accept that these are covered by integration tests
3. **Refactor approach**: Extract testable logic into separate modules

Recommendation: Combination of #1 and #2
- Extract pure logic functions (testable)
- Cover UI integration via E2E tests
- Document that browser-specific code is E2E-tested

### Priority 3: Integration Code (Marked as Ignored) (0 hours)

Files with `/* c8 ignore file */`:
- `packages/sidflow-common/src/playback-harness.ts`
- Various system integration modules

Decision: **Leave as-is**
- These are intentionally excluded
- Require external audio players (ffplay, aplay)
- Covered by manual system testing
- Not counted toward coverage targets

## Implementation Strategy

### Phase 1: Quick Wins (2 hours)
Focus on files at 80-89% that need minor additions:
1. Add error case tests to existing test files
2. Cover edge cases in validation logic
3. Test fallback behaviors

### Phase 2: CLI Mocking (3-4 hours)
1. Create shared CLI test utilities for mocking process interactions
2. Add comprehensive CLI tests for each package
3. Focus on argument parsing and error messages

### Phase 3: Audio & Rendering (2-3 hours)
1. Mock external dependencies (ffmpeg, WASM)
2. Test orchestration and state management
3. Cover error recovery paths

### Phase 4: Browser Code Strategy (1-2 hours)
1. Extract testable logic
2. Add unit tests for pure functions
3. Document E2E coverage for UI interactions

## Coverage Tracking

Track progress with:
```bash
bun run test --coverage 2>&1 | grep "All files"
```

Target metrics:
- Start: 68.55%
- After Phase 1: ~75%
- After Phase 2: ~82%
- After Phase 3: ~88%
- After Phase 4: >90%

## Testing Tools & Patterns

### Mocking Process Interactions
```typescript
import { mock } from 'bun:test';

test('handles --help flag', () => {
    const originalArgv = process.argv;
    const mockExit = mock((code: number) => {});
    
    process.argv = ['bun', 'script.ts', '--help'];
    // Test help output
    
    process.argv = originalArgv;
    expect(mockExit).toHaveBeenCalledWith(0);
});
```

### Mocking Child Processes
```typescript
import { spawn } from 'child_process';
import { mock } from 'bun:test';

const mockSpawn = mock(spawn);
// Configure mock behavior
mockSpawn.mockReturnValue({
    stdout: mockReadableStream,
    stderr: mockReadableStream,
    on: mock(),
});
```

### Testing Async Orchestrators
```typescript
test('orchestrator handles concurrent requests', async () => {
    const orchestrator = new RenderOrchestrator();
    const results = await Promise.all([
        orchestrator.render('file1.sid'),
        orchestrator.render('file2.sid'),
        orchestrator.render('file3.sid'),
    ]);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
});
```

## Success Criteria

- [ ] Overall coverage >90%
- [ ] No critical paths with <80% coverage
- [ ] All new tests pass 3x consecutively
- [ ] Test suite runtime remains <60s for unit tests
- [ ] Coverage report checked into repository

## Timeline

**Optimistic**: 6 hours (experienced with codebase, tools available)
**Realistic**: 8-10 hours (including debugging, edge cases)
**Conservative**: 12 hours (including refactoring, comprehensive coverage)

## Next Steps

1. Start with Phase 1 (quick wins) to build momentum
2. Create shared test utilities for mocking before Phase 2
3. Track progress after each phase
4. Adjust strategy based on actual coverage gains

## Notes

- Some files (playback-harness, ultimate64-client) are intentionally <90% due to hardware requirements
- Browser-only code may need different coverage expectations
- CLI code coverage benefits most from mocking strategies
- Integration tests provide valuable coverage but aren't reflected in unit test metrics
