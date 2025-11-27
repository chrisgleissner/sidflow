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

echo "=== Volume Mount Setup ==="
# Universal architecture:
#   /sidflow/app/       - Application code (immutable from Docker image)
#   /sidflow/workspace/ - HVSC collection, WAV cache, tags (persistent volume)
#   /sidflow/data/      - Classified data, renders, feedback (persistent volume)
# 
# Fly.io: Volume mounts at /mnt/data, we create symlinks to avoid shadowing /sidflow/app
# Pi/K8s: Direct bind mounts at /sidflow/workspace and /sidflow/data
#
if [ -d "/mnt/data" ]; then
    echo "Fly.io deployment detected (/mnt/data volume exists)"
    
    # Create workspace and data subdirectories in the volume
    mkdir -p /mnt/data/workspace /mnt/data/data
    
    # Remove any existing directories/symlinks and create fresh symlinks
    for target in workspace data; do
        if [ -L "/sidflow/$target" ]; then
            rm "/sidflow/$target"
        elif [ -d "/sidflow/$target" ]; then
            # Backup any existing data (shouldn't happen, but be safe)
            mv "/sidflow/$target" "/sidflow/$target.bak.$(date +%s)" 2>/dev/null || rm -rf "/sidflow/$target"
        fi
        ln -s "/mnt/data/$target" "/sidflow/$target"
        echo "  ✓ Created symlink: /sidflow/$target -> /mnt/data/$target"
    done
else
    echo "Local/Pi/K8s deployment detected (no /mnt/data)"
    echo "Using direct mount points: /sidflow/workspace and /sidflow/data"
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
check_path "/sidflow/app/packages/sidflow-web/server.js" "Next.js server" || { echo "FATAL: Next.js server missing"; exit 1; }
check_path "/sidflow/app/packages/sidflow-web/.next" "Next.js build" || { echo "FATAL: Next.js build missing"; exit 1; }

# Required config
check_path "/sidflow/app/.sidflow.json" "Config file" || ((FAILED++))

# Create workspace subdirectories
for dir in "/sidflow/workspace/hvsc" "/sidflow/workspace/wav-cache" "/sidflow/workspace/tags"; do
  if [ ! -d "$dir" ]; then
    if mkdir -p "$dir" 2>/dev/null; then
      echo "✓ Created workspace directory: $dir"
    else
      echo "⚠ Unable to create $dir (will try at runtime)"
    fi
  else
    echo "✓ $dir exists"
  fi
done

# Create data subdirectories
for dir in "/sidflow/data/classified" "/sidflow/data/renders" "/sidflow/data/availability"; do
  if [ ! -d "$dir" ]; then
    if mkdir -p "$dir" 2>/dev/null; then
      echo "✓ Created data directory: $dir"
    else
      echo "⚠ Unable to create $dir (will try at runtime)"
    fi
  else
    echo "✓ $dir exists"
  fi
done
echo ""

echo "=== WASM Files Check ==="
# WASM files are copied to Next.js public/wasm during build:worklet
check_path "/sidflow/app/packages/sidflow-web/public/wasm/libsidplayfp.wasm" "SIDPlayFP WASM (public)" || ((FAILED++))
check_path "/sidflow/app/packages/sidflow-web/public/wasm/libsidplayfp.js" "SIDPlayFP JS (public)" || ((FAILED++))
# Source files should also exist in packages
check_path "/sidflow/app/packages/libsidplayfp-wasm/dist/libsidplayfp.wasm" "SIDPlayFP WASM (source)" || echo "  (optional - only needed for CLI usage)"
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
if [ -f "${SIDFLOW_CONFIG:-/sidflow/app/.sidflow.json}" ]; then
    echo "Config path: ${SIDFLOW_CONFIG:-/sidflow/app/.sidflow.json}"
    cat "${SIDFLOW_CONFIG:-/sidflow/app/.sidflow.json}" | head -30
else
    echo "✗ Config file not found!"
    ((FAILED++))
fi
echo ""

echo "=== Disk Space ==="
df -h /sidflow /tmp | tail -n +2
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

echo "=== Initializing sidplayfp configuration ==="
# Create persistent sidplayfp.ini if it doesn't exist
SIDPLAYFP_INI="/sidflow/data/.sidplayfp.ini"
SIDPLAYFP_CONFIG_DIR="/home/node/.config/sidplayfp"

# Ensure data directory exists and is writable before attempting to write config
mkdir -p /sidflow/data 2>/dev/null || true

if [ ! -f "$SIDPLAYFP_INI" ]; then
    echo "Creating default sidplayfp.ini at $SIDPLAYFP_INI"
    if cat > "$SIDPLAYFP_INI" 2>/dev/null << 'EOF'
[SIDPlayfp]
Version = 2
Songlength Database = /sidflow/workspace/hvsc/update/DOCUMENTS/Songlengths.md5
Default Play Length = 03:30
Default Record Length = 03:30
Kernal Rom = /sidflow/workspace/roms/kernal.901227-03.bin
Basic Rom = /sidflow/workspace/roms/basic.901226-01.bin
Chargen Rom = /sidflow/workspace/roms/characters.901225-01.bin

[Console]
Ansi = true

[Audio]
Frequency = 48000
Channels = 1
BitsPerSample = 16

[Emulation]
Engine = RESIDFP
C64Model = PAL
ForceC64Model = false
SidModel = MOS6581
ForceSidModel = false
UseFilter = true
FilterBias = 0
FilterCurve6581 = 0.5
FilterCurve8580 = 12500
EOF
    then
        echo "✓ Created default sidplayfp.ini"
    else
        echo "⚠ Unable to create $SIDPLAYFP_INI (will use defaults)"
    fi
else
    echo "✓ Using existing sidplayfp.ini"
fi

# Create symlink to persistent location (best effort)
if mkdir -p "$SIDPLAYFP_CONFIG_DIR" 2>/dev/null && [ -f "$SIDPLAYFP_INI" ]; then
    ln -sf "$SIDPLAYFP_INI" "$SIDPLAYFP_CONFIG_DIR/sidplayfp.ini" 2>/dev/null || true
    echo "✓ Linked sidplayfp.ini from persistent storage"
fi

# Provision ROMs if missing (user must provide these copyrighted files)
ROM_DIR="/sidflow/workspace/roms"
if [ ! -f "$ROM_DIR/kernal.901227-03.bin" ] || [ ! -f "$ROM_DIR/basic.901226-01.bin" ] || [ ! -f "$ROM_DIR/characters.901225-01.bin" ]; then
    echo "⚠ WARNING: C64 ROM files not found in $ROM_DIR"
    echo "  Required files:"
    echo "    - kernal.901227-03.bin (8192 bytes)"
    echo "    - basic.901226-01.bin (8192 bytes)"
    echo "    - characters.901225-01.bin (4096 bytes)"
    echo "  These are copyrighted files that must be obtained legally."
    echo "  Place them in the workspace/roms directory and restart the container."
    if ! mkdir -p "$ROM_DIR" 2>/dev/null; then
        echo "⚠ Unable to create $ROM_DIR (check workspace volume permissions)"
    fi
else
    echo "✓ C64 ROM files present"
fi

echo ""
echo "Starting Next.js server..."
echo "  Command: $*"
echo "  Working directory: $(pwd)"
echo "  Server should be at: http://${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
echo ""
exec "$@"
