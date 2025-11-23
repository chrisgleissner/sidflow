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
echo ""

echo "=== Critical Paths Check ==="
FAILED=0

check_path "/sidflow/.sidflow.json" "Config file" || ((FAILED++))
check_path "/sidflow/workspace/hvsc" "HVSC directory" || ((FAILED++))
check_path "/sidflow/workspace/wav-cache" "WAV cache directory" || ((FAILED++))
check_path "/sidflow/workspace/tags" "Tags directory" || ((FAILED++))
check_path "/sidflow/data/classified" "Classified data directory" || ((FAILED++))
check_path "/sidflow/data/renders" "Renders directory" || ((FAILED++))
check_path "/sidflow/data/availability" "Availability directory" || ((FAILED++))
check_path "/app/packages/sidflow-web/server.js" "Next.js server" || ((FAILED++))
check_path "/app/packages/sidflow-web/.next" "Next.js build" || ((FAILED++))
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
    echo "================================================================"
    echo ""
    echo "Starting Next.js server..."
    exec "$@"
else
    echo "✗ Pre-flight checks failed: $FAILED issue(s) found"
    echo "================================================================"
    echo ""
    echo "Container will attempt to start anyway, but health checks may fail."
    echo "Check the logs above to diagnose the issue."
    echo ""
    echo "Starting Next.js server..."
    exec "$@"
fi
