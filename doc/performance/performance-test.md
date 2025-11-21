# Performance Test Guide

This guide explains how to run the unified performance tests (Playwright + k6) locally and in CI using the shared runner.

## Prerequisites

- Bun and Node.js installed locally.
- Playwright Chromium browser installed (`cd packages/sidflow-web && npx playwright install chromium`).
- k6 installed (Dockerfile prebakes k6 v0.52.0 for CI; locally install via your package manager or download the tarball to `performance/tmp/bin/k6` as shown below).
- Built web app running on the target base URL.

To download k6 to the repo-local path (avoids system installs):

```bash
mkdir -p performance/tmp/bin
curl -fsSL https://github.com/grafana/k6/releases/download/v0.52.0/k6-v0.52.0-linux-amd64.tar.gz -o /tmp/k6.tar.gz
tar -xzf /tmp/k6.tar.gz -C performance/tmp/bin --strip-components=1 k6-v0.52.0-linux-amd64/k6
rm /tmp/k6.tar.gz
chmod +x performance/tmp/bin/k6
```

## Quick Local Run (smoke)

1. Start the web server (prod build):
   ```bash
   cd packages/sidflow-web
   npm run build
   PORT=3000 npm run start -- --hostname 0.0.0.0 --port 3000
   ```
2. From the repo root, run the unified runner (local mode uses minimal variants and relaxed SLOs):
   ```bash
   PATH="$(pwd)/performance/tmp/bin:$PATH" npm run perf:run -- --env local --base-url http://localhost:3000 --results performance/results/local --tmp performance/tmp --execute
   ```
3. Outputs:
   - Scripts under `performance/tmp/<timestamp>/`.
   - Results + Markdown report under `performance/results/<timestamp>/`.
   - k6 exports: `report.html` + `summary.json` per journey/variant.

Notes:
- Local runs downscale to 1-user variants and iterations=1 with error-rate guard disabled to avoid failures on empty data.
- Playwright selectors are best-effort; missing UI elements are logged and skipped so runs complete.

## CI / Nightly Run

- Workflow: `.github/workflows/performance.yml` builds the web app, installs k6 and Playwright, starts the server in-job, then runs the unified runner with Playwright (1/10 users) and k6 (1/10/100 users), uploading artifacts.
- Command (mirrors CI):
  ```bash
  npm run perf:run -- --env ci --base-url http://localhost:3000 --results performance/results --tmp performance/tmp --execute
  ```
- k6 HTML dashboard is enabled via `K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html`.

## Remote/Staging Targets (guarded)

Remote targets are disabled by default to avoid accidental production traffic. Enable explicitly:

```bash
npm run perf:run -- --env remote --enable-remote --base-url https://staging.example.com --results performance/results --tmp performance/tmp --execute
```

- Requires both `--env remote` **and** `--enable-remote`.
- Use only against a deployed target you control; defaults stay off.

## Runner Options (scripts/performance-runner.ts)

- `--env local|ci|remote` (remote requires `--enable-remote` + base URL).
- `--base-url <url>` target server.
- `--results`, `--tmp` to override output roots.
- `--journey` / `--executor` filters for subsets.
- Pacing defaults to 3s per action; override with `--pacing <seconds>`.

## HTML Dashboard Export (k6)

Generate a self-contained HTML dashboard during k6 runs:

```shell
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=html-report.html k6 run script.js
```

## Architecture References

- Rollout plan: `doc/performance/unified-performance-testing-rollout.md`
- Architecture: `doc/performance/unified-performance-testing-architecture.md`
