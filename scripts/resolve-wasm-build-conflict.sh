#!/bin/bash
# Simple script to resolve wasm-build.json merge conflicts by choosing the newer timestamp

set -e

WASM_BUILD_FILE="data/wasm-build.json"

if [[ ! -f "$WASM_BUILD_FILE" ]]; then
    echo "Error: $WASM_BUILD_FILE not found"
    exit 1
fi

# Check if there are conflict markers
if ! grep -q "<<<<<<< HEAD" "$WASM_BUILD_FILE"; then
    echo "No conflicts found in $WASM_BUILD_FILE"
    exit 0
fi

echo "Resolving wasm-build.json timestamp conflict..."

# Extract the two timestamps
HEAD_TIMESTAMP=$(grep -A1 "<<<<<<< HEAD" "$WASM_BUILD_FILE" | grep "lastChecked" | sed 's/.*"lastChecked": "\([^"]*\)".*/\1/')
OTHER_TIMESTAMP=$(grep -A1 ">>>>>>> " "$WASM_BUILD_FILE" | grep "lastChecked" | sed 's/.*"lastChecked": "\([^"]*\)".*/\1/')

echo "HEAD timestamp: $HEAD_TIMESTAMP"
echo "Other timestamp: $OTHER_TIMESTAMP"

# Choose the newer timestamp
if [[ "$HEAD_TIMESTAMP" > "$OTHER_TIMESTAMP" ]]; then
    CHOSEN_TIMESTAMP="$HEAD_TIMESTAMP"
    echo "Choosing HEAD timestamp (newer)"
else
    CHOSEN_TIMESTAMP="$OTHER_TIMESTAMP"
    echo "Choosing other timestamp (newer)"
fi

# Create resolved version
cat > "$WASM_BUILD_FILE" << EOF
{
  "lastChecked": "$CHOSEN_TIMESTAMP",
  "lastSuccessfulBuild": {
    "artifact": "/home/chris/dev/c64/sidflow/packages/libsidplayfp-wasm/dist/libsidplayfp.wasm",
    "commit": "7284e97bda67a838dadd3c2e361798b4f5b6ab30",
    "notes": "Phase 4 deterministic build via bun run wasm:build; artifacts committed.",
    "timestamp": "2025-11-10T22:05:30.028Z"
  },
  "latestUpstreamCommit": "7284e97bda67a838dadd3c2e361798b4f5b6ab30",
  "upstreamRepo": "https://github.com/libsidplayfp/libsidplayfp"
}
EOF

echo "✓ Resolved conflict in $WASM_BUILD_FILE with timestamp: $CHOSEN_TIMESTAMP"
echo "Now run: git add $WASM_BUILD_FILE && git commit"