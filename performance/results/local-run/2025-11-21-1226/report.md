# Performance Run 2025-11-21-1226

## Commands

- play-start-stream (playwright u1): `BASE_URL=http://localhost:3000 NODE_PATH=/home/chris/dev/c64/sidflow/packages/sidflow-performance/node_modules bun run /home/chris/dev/c64/sidflow/performance/tmp/2025-11-21-1226/playwright/play-start-stream-u001.spec.ts` → results at playwright/play-start-stream/u001 (k6: err=0.5, p95=7.908878649999999, rps=0.2218539927119863)
- play-start-stream (k6 u1): `BASE_URL=http://localhost:3000 K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=/home/chris/dev/c64/sidflow/performance/results/local-run/2025-11-21-1226/k6/play-start-stream/u001/report.html K6_SUMMARY_EXPORT=/home/chris/dev/c64/sidflow/performance/results/local-run/2025-11-21-1226/k6/play-start-stream/u001/summary.json k6 run /home/chris/dev/c64/sidflow/performance/tmp/2025-11-21-1226/k6/play-start-stream-u001.js` → results at k6/play-start-stream/u001 (k6: err=0.5, p95=7.908878649999999, rps=0.2218539927119863)