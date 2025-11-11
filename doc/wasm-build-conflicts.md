# WASM Build Timestamp Conflict Resolution

The `data/wasm-build.json` file contains a `lastChecked` timestamp that gets updated whenever the WASM build system runs. This frequently causes merge conflicts when merging branches.

## Automatic Resolution (Recommended)

We've set up a custom git merge driver that automatically resolves these conflicts by choosing the newer timestamp:

1. **`.gitattributes`** - Configures `data/wasm-build.json` to use the custom merge driver
2. **`scripts/git-merge-wasm-build.sh`** - The merge driver script that compares timestamps and chooses the newer one
3. **Git config** - Configured to use the merge driver

### How it works:
- When git encounters a conflict in `data/wasm-build.json`, it automatically runs our script
- The script compares the `lastChecked` timestamps from both branches
- It keeps the newer timestamp and preserves all other data
- The merge completes automatically without manual intervention

### Setup for new clones:
```bash
# The .gitattributes file is committed, but you need to configure the merge driver:
git config merge.wasm-build-merge.driver './scripts/git-merge-wasm-build.sh %O %A %B %L %P'
git config merge.wasm-build-merge.name 'WASM build timestamp auto-resolver'
```

## Manual Resolution (Fallback)

If the automatic resolution fails or you prefer manual control:

```bash
# Run the conflict resolver script
./scripts/resolve-wasm-build-conflict.sh

# Then commit the resolved file
git add data/wasm-build.json
git commit
```

## Why This Approach?

1. **Automatic** - No manual intervention needed for common timestamp conflicts
2. **Safe** - Only resolves timestamp conflicts, preserves all other data
3. **Intelligent** - Always chooses the newer timestamp (most recent build check)
4. **Fallback** - Manual script available if automatic resolution fails
5. **Portable** - Works across all development environments

## File Structure

The `data/wasm-build.json` file has this structure:
```json
{
  "lastChecked": "2025-11-11T18:11:28.091Z",  // ← This causes conflicts
  "lastSuccessfulBuild": { ... },             // ← Stable data
  "latestUpstreamCommit": "...",               // ← Stable data  
  "upstreamRepo": "..."                        // ← Stable data
}
```

Only the `lastChecked` field typically conflicts during merges.