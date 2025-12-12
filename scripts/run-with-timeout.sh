#!/usr/bin/env bash
# Run a command with a hard timeout and sensible termination semantics.
# Usage:
#   scripts/run-with-timeout.sh <timeout-seconds> -- <command> [args...]
# Examples:
#   scripts/run-with-timeout.sh 600 -- bun run test
#   scripts/run-with-timeout.sh 120 -- scripts/docker-smoke.sh

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <timeout-seconds> -- <command> [args...]" >&2
  exit 2
fi

timeout_seconds="$1"
shift

if [[ "$1" != "--" ]]; then
  echo "Expected '--' after timeout seconds" >&2
  exit 2
fi
shift

if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]]; then
  echo "Timeout must be an integer number of seconds" >&2
  exit 2
fi

if command -v timeout >/dev/null 2>&1; then
  # First send SIGTERM, then SIGKILL after grace.
  timeout --signal=TERM --kill-after=15s "${timeout_seconds}s" "$@"
else
  echo "ERROR: 'timeout' command not available (coreutils). Install it to use this wrapper." >&2
  exit 127
fi
