/**
 * Custom Playwright reporter that enables coverage collection
 * This runs automatically for all tests without modification
 */
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import { startCoverage, stopCoverage, saveCoverage } from './helpers/coverage';

class CoverageReporter implements Reporter {
  private coveragePages = new WeakMap();

  onBegin(config: FullConfig, suite: Suite) {
    console.log('[E2E Coverage Reporter] Coverage collection enabled for all tests');
  }

  async onTestBegin(test: TestCase, result: TestResult) {
    // Coverage is started per-page in the fixture
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    // Coverage is stopped per-page in the fixture
  }

  async onEnd(result: FullResult) {
    console.log('[E2E Coverage Reporter] Saving collected coverage...');
    await saveCoverage();
    console.log('[E2E Coverage Reporter] Coverage saved');
  }
}

export default CoverageReporter;
