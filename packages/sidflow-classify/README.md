# @sidflow/classify

WAV rendering and Essentia.js feature extraction for SID files.

## Usage

```bash
bun ./scripts/sidflow-classify [--config <path>] [--force-rebuild] [--limit <n>] [--sid-path-prefix <prefix>]
```

## Output

- WAV files → `audioCachePath/`
- Features → `data/classified/*.jsonl`
