# Performance Testing

Unified performance testing system using Playwright (browser-mode) and k6 (protocol-mode) with shared journey specs.

## Quick Start

```bash
# 1. Install k6 locally (optional - CI has it preinstalled)
mkdir -p performance/tmp/bin
curl -fsSL https://github.com/grafana/k6/releases/download/v0.52.0/k6-v0.52.0-linux-amd64.tar.gz | \
  tar -xzf - -C performance/tmp/bin --strip-components=1 k6-v0.52.0-linux-amd64/k6

# 2. Start the web server
cd packages/sidflow-web && npm run build && PORT=3000 npm start

# 3. Run performance tests (local mode)
PATH="$(pwd)/performance/tmp/bin:$PATH" npm run perf:run -- \
  --env local --base-url http://localhost:3000 \
  --results performance/results/local --execute
```

## Architecture

- **Journey specs** (`performance/journeys/`): Declarative JSON describing navigation, clicks, and assertions
- **Executors**:
  - Playwright: Real browser, HAR/trace capture, 3s pacing
  - k6: Protocol-level, scalable (1/10/100 users), CSV + HTML dashboard
- **Runner** (`scripts/performance-runner.ts`): Orchestrates execution and generates reports

## Run Modes

| Mode | Command | Users | Use Case |
|------|---------|-------|----------|
| Local | `--env local` | 1 | Quick smoke tests |
| CI | `--env ci` | 1/10/100 | Nightly scheduled runs |
| Remote | `--env remote --enable-remote` | Configurable | Staging/production |

## Runner Options

```bash
npm run perf:run -- [options]
  --env local|ci|remote    Target environment
  --base-url <url>         Server URL
  --results <dir>          Output directory
  --journey <name>         Filter specific journey
  --executor playwright|k6 Filter executor type
  --pacing <seconds>       Override 3s default
  --enable-remote          Required for remote targets
```

## Output Structure

```
performance/results/<timestamp>/
├── journeys/              # Copied specs for traceability
├── playwright/<journey>/  # Browser timings, traces
├── k6/<journey>/          # CSV, HTML dashboards, summary.json
└── report.md              # Aggregated markdown report
```

## CI Integration

The nightly workflow (`.github/workflows/performance.yml`):
1. Builds web app, starts server
2. Runs Playwright (1/10 users)
3. Runs k6 (1/10/100 users) with `K6_WEB_DASHBOARD=true`
4. Uploads artifacts and generates summary

## Interpreting Results

- **p95/p99 latencies**: Target <500ms for API, <2s for page loads
- **Error rate**: Target <5% (gated via `maxErrorRate`)
- **Throughput**: Monitor for regressions between runs
