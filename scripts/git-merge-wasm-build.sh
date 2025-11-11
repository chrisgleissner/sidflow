#!/bin/bash
# Git merge driver for wasm-build.json that automatically chooses the newer timestamp
# Usage: wasm-build-merge %O %A %B %L %P
# %O = ancestor version
# %A = current version (HEAD)
# %B = other version (branch being merged)
# %L = conflict marker size (usually 7)
# %P = path name

BASE="$1"
CURRENT="$2"
OTHER="$3"
MARKER_SIZE="$4"
PATH="$5"

# Extract timestamps using jq
CURRENT_TIMESTAMP=$(jq -r '.lastChecked' "$CURRENT" 2>/dev/null || echo "")
OTHER_TIMESTAMP=$(jq -r '.lastChecked' "$OTHER" 2>/dev/null || echo "")

# If we can't parse timestamps, fall back to standard merge
if [[ -z "$CURRENT_TIMESTAMP" || -z "$OTHER_TIMESTAMP" ]]; then
    echo "Warning: Could not parse timestamps in $PATH, falling back to manual resolution" >&2
    exit 1
fi

# Compare timestamps and choose the newer one
if [[ "$CURRENT_TIMESTAMP" > "$OTHER_TIMESTAMP" ]]; then
    echo "Auto-resolving $PATH: keeping current timestamp ($CURRENT_TIMESTAMP)" >&2
    cp "$CURRENT" "$CURRENT.resolved"
else
    echo "Auto-resolving $PATH: using other timestamp ($OTHER_TIMESTAMP)" >&2
    # Use OTHER file but ensure we keep the rest of the structure from CURRENT
    jq --arg new_timestamp "$OTHER_TIMESTAMP" '.lastChecked = $new_timestamp' "$CURRENT" > "$CURRENT.resolved"
fi

# Replace the current file with resolved version
mv "$CURRENT.resolved" "$CURRENT"
exit 0