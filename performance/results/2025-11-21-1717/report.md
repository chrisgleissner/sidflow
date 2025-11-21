# Performance Run 2025-11-21-1717

## Commands

- play-start-stream (playwright u1): `BASE_URL=http://localhost:3000 NODE_PATH=/home/runner/work/sidflow/sidflow/packages/sidflow-performance/node_modules bun run /home/runner/work/sidflow/sidflow/performance/tmp/2025-11-21-1717/playwright/play-start-stream-u001.spec.ts` → results at playwright/play-start-stream/u001
- play-start-stream (k6 u1): `BASE_URL=http://localhost:3000 K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=/home/runner/work/sidflow/sidflow/performance/results/2025-11-21-1717/k6/play-start-stream/u001/report.html K6_SUMMARY_EXPORT=/home/runner/work/sidflow/sidflow/performance/results/2025-11-21-1717/k6/play-start-stream/u001/summary.json k6 run /home/runner/work/sidflow/sidflow/performance/tmp/2025-11-21-1717/k6/play-start-stream-u001.js` → results at k6/play-start-stream/u001