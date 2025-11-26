#!/usr/bin/env bash
# Docker container startup script with comprehensive pre-flight checks
# This runs before the Next.js server to validate the environment

set -euo pipefail

echo "================================================================"
echo "SIDFlow Docker Container Startup Diagnostics"
echo "================================================================"
echo "Timestamp: $(date -Iseconds)"
echo "User: $(whoami) (UID=$(id -u), GID=$(id -g))"
echo "Working directory: $(pwd)"
echo "Hostname: $(hostname)"
echo ""

# Function to check if a path exists and log details
check_path() {
    local path="$1"
    local description="$2"
    
    if [ -e "$path" ]; then
        if [ -d "$path" ]; then
            echo "✓ $description exists (directory)"
            ls -la "$path" | head -5
        elif [ -f "$path" ]; then
            echo "✓ $description exists (file, $(stat -c%s "$path") bytes)"
        fi
    else
        echo "✗ $description MISSING: $path"
        return 1
    fi
}

# Function to check command availability
check_command() {
    local cmd="$1"
    if command -v "$cmd" >/dev/null 2>&1; then
        echo "✓ Command '$cmd' available: $(command -v "$cmd")"
        "$cmd" --version 2>&1 | head -1 || echo "  (no version info)"
    else
        echo "✗ Command '$cmd' NOT FOUND"
        return 1
    fi
}

echo "=== Environment Variables ==="
echo "NODE_ENV=${NODE_ENV:-<not set>}"
echo "SIDFLOW_CONFIG=${SIDFLOW_CONFIG:-<not set>}"
echo "SIDFLOW_ROOT=${SIDFLOW_ROOT:-<not set>}"
echo "PORT=${PORT:-<not set>}"
echo "HOSTNAME=${HOSTNAME:-<not set>}"
# Redact sensitive variables
if [ -n "${SIDFLOW_ADMIN_USER:-}" ]; then
    echo "SIDFLOW_ADMIN_USER=<redacted>"
fi
if [ -n "${SIDFLOW_ADMIN_PASSWORD:-}" ]; then
    echo "SIDFLOW_ADMIN_PASSWORD=<redacted>"
fi
if [ -n "${SIDFLOW_ADMIN_SECRET:-}" ]; then
    echo "SIDFLOW_ADMIN_SECRET=<redacted>"
fi
echo ""

echo "=== Mount Ownership Validation ==="
# Validate that mounted volumes are accessible to the current user
# Use actual current UID, not hardcoded value
CURRENT_UID=$(id -u)
for mount_path in "/sidflow/workspace" "/sidflow/data"; do
    if [ -d "$mount_path" ]; then
        actual_uid=$(ls -ldn "$mount_path" | awk '{print $3}')
        # Check if we can actually write (best test)
        if touch "$mount_path/.write-test" 2>/dev/null; then
            rm -f "$mount_path/.write-test"
            echo "✓ $mount_path is writable (owned by UID $actual_uid, running as UID $CURRENT_UID)"
        else
            echo "⚠ Warning: $mount_path NOT writable (owned by UID $actual_uid, running as UID $CURRENT_UID)"
            echo "  Container may have permission issues writing to mounted volumes"
        fi
    fi
done
echo ""

echo "=== Critical Paths Check ==="
FAILED=0

# Critical paths that MUST exist (exit if missing)
check_path "/app/packages/sidflow-web/server.js" "Next.js server" || { echo "FATAL: Next.js server missing"; exit 1; }
check_path "/app/packages/sidflow-web/.next" "Next.js build" || { echo "FATAL: Next.js build missing"; exit 1; }

# Required config
check_path "/sidflow/.sidflow.json" "Config file" || ((FAILED++))

# Data directories (auto-create if missing)
for dir in "/sidflow/workspace/hvsc" "/sidflow/workspace/wav-cache" "/sidflow/workspace/tags" "/sidflow/data/classified" "/sidflow/data/renders" "/sidflow/data/availability"; do
  if [ ! -d "$dir" ]; then
    echo "⚠ Creating missing directory: $dir"
    mkdir -p "$dir" 2>/dev/null || echo "  (unable to create, will try at runtime)"
  else
    echo "✓ $dir exists"
  fi
done
echo ""

echo "=== WASM Files Check ==="
# WASM files are copied to Next.js public/wasm during build:worklet
check_path "/app/packages/sidflow-web/public/wasm/libsidplayfp.wasm" "SIDPlayFP WASM (public)" || ((FAILED++))
check_path "/app/packages/sidflow-web/public/wasm/libsidplayfp.js" "SIDPlayFP JS (public)" || ((FAILED++))
# Source files should also exist in packages
check_path "/sidflow/packages/libsidplayfp-wasm/dist/libsidplayfp.wasm" "SIDPlayFP WASM (source)" || echo "  (optional - only needed for CLI usage)"
echo ""

echo "=== Command Availability ==="
check_command "node" || ((FAILED++))
check_command "bun" || ((FAILED++))
check_command "sidplayfp" || ((FAILED++))
check_command "ffmpeg" || ((FAILED++))
check_command "curl" || ((FAILED++))
echo ""

echo "=== Binary Versions ==="
if command -v sidplayfp >/dev/null 2>&1; then
    echo "sidplayfp: $(sidplayfp --version 2>&1 | head -1)"
fi
if command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
fi
echo ""

echo "=== Config File Content ==="
if [ -f "${SIDFLOW_CONFIG:-/sidflow/.sidflow.json}" ]; then
    echo "Config path: ${SIDFLOW_CONFIG:-/sidflow/.sidflow.json}"
    cat "${SIDFLOW_CONFIG:-/sidflow/.sidflow.json}" | head -30
else
    echo "✗ Config file not found!"
    ((FAILED++))
fi
echo ""

echo "=== Disk Space ==="
df -h /sidflow /app /tmp | tail -n +2
echo ""

echo "=== Network Check ==="
echo "Listening on ports:"
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "(netstat/ss not available)"
echo ""

echo "================================================================"
if [ $FAILED -eq 0 ]; then
    echo "✓ All pre-flight checks passed!"
else
    echo "⚠ Pre-flight checks: $FAILED issue(s) found"
    echo "  Container will start anyway. Check logs above for details."
fi
echo "================================================================"
echo ""
echo "Starting Next.js server..."
echo "  Command: $*"
echo "  Working directory: $(pwd)"
echo "  Server should be at: http://${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
echo ""
exec "$@"
