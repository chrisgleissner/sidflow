#!/usr/bin/env bash
set -e

echo "========================================="
echo "Running Full Coverage: Unit + E2E Tests"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0.32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Run unit tests with coverage
echo -e "${BLUE}[1/4] Running unit tests with coverage...${NC}"
bun test $(find packages/*/test packages/sidflow-web/tests/unit integration-tests -name '*.test.ts' -type f 2>/dev/null) \
  --coverage \
  --coverage-reporter=lcov \
  --exclude='**/*.spec.ts' \
  --exclude='**/tests/e2e/**' \
  --exclude='**/dist/**'

UNIT_EXIT=$?
if [ $UNIT_EXIT -ne 0 ]; then
  echo "❌ Unit tests failed with exit code $UNIT_EXIT"
  exit $UNIT_EXIT
fi

echo -e "${GREEN}✓ Unit tests passed${NC}"
echo ""

# Step 2: Run E2E tests with coverage
echo -e "${BLUE}[2/4] Running E2E tests with coverage...${NC}"
cd packages/sidflow-web

# Clean previous E2E coverage
rm -rf .next .nyc_output coverage-e2e

# Check if Playwright browsers are installed
if ! npx playwright --version >/dev/null 2>&1; then
  echo "Installing Playwright..."
  npx playwright install chromium
fi

# Run E2E with coverage
E2E_COVERAGE=true npx playwright test --project=chromium

E2E_EXIT=$?
cd ../..

if [ $E2E_EXIT -ne 0 ]; then
  echo "⚠️  E2E tests had issues (exit code $E2E_EXIT), but continuing with available coverage"
fi

echo -e "${GREEN}✓ E2E tests completed${NC}"
echo ""

# Step 3: Merge coverage
echo -e "${BLUE}[3/4] Merging unit + E2E coverage...${NC}"
bun run scripts/merge-coverage.ts

MERGE_EXIT=$?
if [ $MERGE_EXIT -ne 0 ]; then
  echo "❌ Coverage merge failed"
  exit $MERGE_EXIT
fi

echo -e "${GREEN}✓ Coverage merged${NC}"
echo ""

# Step 4: Generate report
echo -e "${BLUE}[4/4] Generating coverage report...${NC}"

# Check if lcov is installed for HTML reports
if command -v genhtml >/dev/null 2>&1; then
  genhtml coverage-merged/lcov.info -o coverage-merged/html
  echo "HTML report generated at: coverage-merged/html/index.html"
fi

# Summary from merged coverage
if [ -f coverage-merged/lcov.info ]; then
  TOTAL_LINES=$(grep -c "^DA:" coverage-merged/lcov.info || echo "0")
  HIT_LINES=$(grep "^DA:" coverage-merged/lcov.info | grep -c ",0$" || echo "0")
  MISSED=$HIT_LINES
  COVERED=$((TOTAL_LINES - MISSED))
  if [ $TOTAL_LINES -gt 0 ]; then
    COVERAGE=$(awk "BEGIN {printf \"%.2f\", ($COVERED / $TOTAL_LINES) * 100}")
    echo ""
    echo "========================================="
    echo -e "${GREEN}Combined Coverage: ${COVERAGE}%${NC}"
    echo "Total lines: $TOTAL_LINES"
    echo "Covered: $COVERED"
    echo "Missed: $MISSED"
    echo "========================================="
  fi
fi

echo ""
echo -e "${GREEN}✓ Full coverage collection complete!${NC}"
echo "Merged coverage available at: coverage-merged/lcov.info"
