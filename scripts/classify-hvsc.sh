#!/usr/bin/env bash
# classify-hvsc.sh — Crash-resistant full HVSC classification runner.
#
# USAGE:
#   ./scripts/classify-hvsc.sh [--config <path>] [--max-attempts <n>]
#
# Runs sidflow-classify with --skip-already-classified in a retry loop.
# After each crash it salvages partial features JSONL via --resume-from-features,
# which writes auto-tags.json for songs completed before the crash so the next
# attempt can skip them.
#
# Environment overrides:
#   SIDFLOW_CONFIG   — path to .sidflow.json (default: .sidflow.json in cwd)
#   MAX_ATTEMPTS     — max retry iterations (default: 50)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLASSIFY_CMD="./scripts/sidflow-classify"
CONFIG_PATH="${SIDFLOW_CONFIG:-.sidflow.json}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-50}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)    CONFIG_PATH="$2"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo "[classify-hvsc] Config:       $CONFIG_PATH"
echo "[classify-hvsc] Max attempts: $MAX_ATTEMPTS"
echo "[classify-hvsc] Started at:   $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# Resolve classifiedPath from the config (default: data/classified)
CLASSIFIED_PATH=$(python3 -c "
import json, os, sys
try:
    cfg = json.load(open('$CONFIG_PATH'))
    cp = cfg.get('classifiedPath', 'data/classified')
    # Handle relative paths
    if not os.path.isabs(cp):
        cp = os.path.join(os.path.dirname(os.path.abspath('$CONFIG_PATH')), cp)
    print(cp)
except Exception as e:
    print('data/classified', file=sys.stderr)
    print('data/classified')
" 2>/dev/null)

echo "[classify-hvsc] Classified path: $CLASSIFIED_PATH"

attempt=0
while [[ $attempt -lt $MAX_ATTEMPTS ]]; do
  attempt=$((attempt + 1))
  echo ""
  echo "=== Attempt $attempt / $MAX_ATTEMPTS  $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="

  # Step 1: Try to salvage any partial Phase 1 work from the latest features file
  LATEST_FEATURES=$(ls -t "$CLASSIFIED_PATH"/features_*.jsonl 2>/dev/null | head -1 || true)
  if [[ -n "$LATEST_FEATURES" && -s "$LATEST_FEATURES" ]]; then
    echo "[classify-hvsc] Salvaging partial features from: $LATEST_FEATURES"
    # Run Phase 2 only on the partial features file to write auto-tags.json
    # Use --skip-already-classified so songs already in auto-tags.json are not overwritten
    if "$CLASSIFY_CMD" \
        --config "$CONFIG_PATH" \
        --resume-from-features "$LATEST_FEATURES" \
        --skip-already-classified \
        2>&1 | tail -20; then
      echo "[classify-hvsc] Phase 2 resume completed successfully"
    else
      RESUME_EXIT=$?
      echo "[classify-hvsc] Phase 2 resume exited with $RESUME_EXIT (continuing anyway)"
    fi
  fi

  # Step 2: Run the full classification, skipping already-classified songs
  echo "[classify-hvsc] Running classify --skip-already-classified ..."
  set +e
  "$CLASSIFY_CMD" \
    --config "$CONFIG_PATH" \
    --skip-already-classified \
    2>&1
  CLASSIFY_EXIT=$?
  set -e

  echo "[classify-hvsc] classify exited with: $CLASSIFY_EXIT"

  if [[ $CLASSIFY_EXIT -eq 0 ]]; then
    echo ""
    echo "=== Classification complete! ==="
    echo "=== Finished at: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
    exit 0
  fi

  echo "[classify-hvsc] Classify crashed (exit $CLASSIFY_EXIT). Will retry after salvage."
  sleep 3
done

echo ""
echo "[classify-hvsc] ERROR: Exhausted $MAX_ATTEMPTS attempts without completing."
echo "[classify-hvsc] Check logs for crash details."
exit 1
