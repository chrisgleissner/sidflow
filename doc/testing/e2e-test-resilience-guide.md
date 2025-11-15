# E2E Test Resilience Guide

This document outlines best practices for writing resilient end-to-end tests in SIDFlow, specifically focusing on preventing flaky tests in CI environments.

## Problem Background

E2E tests can become flaky due to:
1. **Timing issues**: Fixed waits that don't account for variable page load times
2. **Resource contention**: CI environments have limited CPU/memory
3. **Network variability**: API responses may take longer in CI
4. **Browser state**: Pages can close unexpectedly under load
5. **Race conditions**: Async operations completing in unpredictable order

## Core Principles

### 1. Never Use Fixed Timeouts for Synchronization

❌ **Bad:**
```typescript
await page.waitForTimeout(500); // Arbitrary delay
```

✅ **Good:**
```typescript
// Wait for specific conditions
await page.waitForLoadState('domcontentloaded');
await page.waitForSelector('[data-testid="content"]', { state: 'visible' });
```

### 2. Always Handle Errors Gracefully

❌ **Bad:**
```typescript
await page.click('button'); // May fail if page closes
```

✅ **Good:**
```typescript
try {
  if (page.isClosed()) {
    throw new Error('Page closed before interaction');
  }
  await page.click('button', { timeout: 10000 });
} catch (error) {
  console.error('[TestName] Click failed:', error);
  throw error;
}
```

### 3. Use Dynamic Waits with Reasonable Timeouts

✅ **Good:**
```typescript
// Wait for network to settle
await page.waitForLoadState('networkidle', { timeout: 5000 })
  .catch(() => {
    console.warn('[TestName] Network idle timeout (expected in dev)');
  });

// Wait for specific element with timeout
await page.waitForSelector('[role="main"]', { 
  state: 'visible',
  timeout: 10000 
});
```

### 4. Add Diagnostic Logging

✅ **Good:**
```typescript
test('my test', async ({ page }) => {
  try {
    console.log('[MyTest] Starting navigation');
    await page.goto('/my-page');
    
    console.log('[MyTest] Waiting for content');
    await page.waitForSelector('.content');
    
    console.log('[MyTest] Taking screenshot');
    await page.screenshot({ path: 'screenshot.png' });
  } catch (error) {
    console.error('[MyTest] Test failed:', error);
    throw error;
  }
});
```

### 5. Monitor Page State

✅ **Good:**
```typescript
function setupPageMonitoring(page: Page, testName: string): void {
  page.on('close', () => {
    console.error(`[${testName}] Page closed unexpectedly`);
  });
  
  page.on('crash', () => {
    console.error(`[${testName}] Page crashed`);
  });
  
  page.on('pageerror', (error) => {
    console.error(`[${testName}] Page error:`, error);
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  setupPageMonitoring(page, testInfo.title);
});
```

## Specific Patterns for SIDFlow

### Pattern 1: Waiting for Tab Content to Load

```typescript
async function waitForTabReady(page: Page, tabName: string): Promise<void> {
  // Wait for initial DOM
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
  
  // Wait for network (may not complete in dev mode)
  await page.waitForLoadState('networkidle', { timeout: 5000 })
    .catch(() => {
      console.warn(`[${tabName}] Network idle timeout (expected)`);
    });
  
  // Wait for fonts to load
  await page.waitForFunction(
    () => {
      const fonts = (document as any).fonts;
      return !fonts || fonts.status === 'loaded';
    },
    undefined,
    { timeout: 3000 }
  ).catch(() => {
    console.warn(`[${tabName}] Font loading timeout`);
  });
}
```

### Pattern 2: Navigation with Error Context

```typescript
async function navigateToTab(
  page: Page, 
  tabValue: string, 
  isAdmin: boolean = false
): Promise<void> {
  const basePath = isAdmin ? '/admin' : '/';
  const url = `${basePath}?tab=${tabValue}`;
  
  try {
    console.log(`[Navigation] Going to ${url}`);
    
    // Navigate with extended timeout
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Verify page didn't close
    if (page.isClosed()) {
      throw new Error(`Page closed after navigation to ${url}`);
    }
    
    console.log(`[Navigation] Successfully loaded ${url}`);
  } catch (error) {
    console.error(`[Navigation] Failed to load ${url}:`, error);
    throw error;
  }
}
```

### Pattern 3: Screenshot Tests

```typescript
test('screenshot test', async ({ page }) => {
  // Set appropriate timeout
  test.setTimeout(60000);
  
  try {
    // Navigate
    await navigateToTab(page, 'classify', true);
    
    // Wait for content
    await page.waitForSelector('h1', { timeout: 10000 });
    
    // Wait for UI stability
    await waitForTabReady(page, 'classify');
    
    // Take screenshot with timeout
    await page.screenshot({
      path: 'screenshot.png',
      fullPage: true,
      timeout: 10000,
    });
  } catch (error) {
    console.error('[Screenshot] Test failed:', error);
    
    // Try to take error screenshot for debugging
    try {
      await page.screenshot({
        path: 'screenshot-error.png',
        fullPage: true,
      });
    } catch (screenshotError) {
      console.error('[Screenshot] Failed to capture error screenshot');
    }
    
    throw error;
  }
});
```

## Test Configuration

### Playwright Config Best Practices

```typescript
export default defineConfig({
  // Use reasonable global timeout
  timeout: 15 * 1000,
  
  // Enable retries on CI for flaky tests
  retries: process.env.CI ? 2 : 0,
  
  // Limit workers to avoid resource exhaustion
  workers: process.env.CI ? 6 : undefined,
  
  // Use trace on retry for debugging
  use: {
    trace: 'on-first-retry',
    video: process.env.CI ? 'retain-on-failure' : 'on',
    
    // Add screenshot on failure
    screenshot: 'only-on-failure',
  },
});
```

### Individual Test Timeouts

```typescript
// For fast unit-like tests
test.setTimeout(10000);

// For standard e2e tests
test.setTimeout(30000);

// For complex integration tests (screenshots, etc.)
test.setTimeout(60000);
```

## Common Anti-Patterns to Avoid

### 1. Cascading Timeouts

❌ **Bad:**
```typescript
await page.waitForTimeout(500);
await page.waitForTimeout(1000);
await page.waitForTimeout(2000); // Total: 3.5s of arbitrary waiting
```

### 2. Ignoring Errors Silently

❌ **Bad:**
```typescript
await page.click('button').catch(() => {}); // Silent failure
```

### 3. Not Checking Page State

❌ **Bad:**
```typescript
await page.type('input', 'text'); // May fail if page closed
```

### 4. Over-relying on Retries

❌ **Bad:**
```typescript
// Using retries to mask timing issues instead of fixing the root cause
retries: 10
```

## CI-Specific Considerations

### Resource Limits
- CI environments typically have:
  - Limited CPU (2-4 cores)
  - Limited memory (4-8GB)
  - Slower disk I/O
  - Network variability

### Recommendations
1. **Increase timeouts** by 2-3x compared to local development
2. **Reduce parallelism** to avoid resource contention
3. **Add diagnostic logging** to understand CI-specific failures
4. **Use retry strategies** wisely (2-3 retries maximum)
5. **Monitor test duration** to detect performance regressions

## Debugging Flaky Tests

### Step 1: Reproduce Locally
```bash
# Run test multiple times
for i in {1..10}; do
  echo "Run $i"
  bun run test:e2e
  if [ $? -ne 0 ]; then
    echo "Failed on run $i"
    break
  fi
done
```

### Step 2: Add Diagnostic Logging
- Add console.log statements at key points
- Monitor page events (close, crash, pageerror)
- Log timing information

### Step 3: Check CI Artifacts
- Review test videos
- Examine trace files
- Check error screenshots
- Review browser console logs

### Step 4: Identify Pattern
- Does it fail at the same point?
- Is it resource-related (memory, CPU)?
- Is it timing-related (race condition)?
- Is it network-related (slow API)?

### Step 5: Implement Fix
- Apply appropriate pattern from this guide
- Validate fix with multiple test runs
- Monitor in CI for stability

## Checklist for New E2E Tests

Before adding a new e2e test, verify:

- [ ] No fixed `waitForTimeout()` calls except for small UI settle delays (<300ms)
- [ ] All async operations have explicit timeouts
- [ ] Error handling includes diagnostic logging
- [ ] Page state is checked before interactions
- [ ] Test timeout is appropriate for test complexity
- [ ] Retries are enabled in CI (but not relied upon)
- [ ] Test includes monitoring for page close/crash
- [ ] Test has been run locally 10+ times successfully

## Future Improvements

1. **Test Analytics Dashboard**
   - Track test duration over time
   - Identify flaky tests automatically
   - Alert on regression patterns

2. **Custom Wait Utilities**
   - Create reusable wait helpers
   - Standardize timeout values
   - Centralize retry logic

3. **Resource Monitoring**
   - Track memory/CPU during tests
   - Detect resource exhaustion
   - Adjust parallelism dynamically

4. **Smart Retries**
   - Exponential backoff
   - Category-based retry strategies
   - Automatic failure classification

## References

- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Timeouts](https://playwright.dev/docs/test-timeouts)
- [Debugging Flaky Tests](https://playwright.dev/docs/test-retries)
