# Classification speed journey — DEMOS/G-L

Goal: iteratively reduce classification runtime for the DEMOS/G-L sandbox while keeping stations within a 10% deviation budget from a baseline.

## Definitions

- **Baseline**: the existing stations in `tmp/demos-gl/stations`.
- **Baseline mismatch note**: if `tmp/demos-gl/stations` was built from a JSONL produced under different settings than `tmp/demos-gl/.sidflow.json` (e.g. different analysis window), then a “baseline” re-classification using the config will *legitimately* diverge. The journey runner may capture a baseline reference snapshot under the current config to keep comparisons apples-to-apples.
- **Deviation / accuracy**: Stations are matched by `seed.key`. For each matched station, we compare membership sets (seed + tracks) using:
  - **Jaccard similarity**:
    $$J(A,B)=\frac{|A\cap B|}{|A\cup B|}$$
  - **Recall** (baseline coverage):
    $$R(A,B)=\frac{|A\cap B|}{|A|}$$
  where $A$ is the baseline station’s membership set and $B$ is the run station’s membership set.
  - We stop when **mean or min Jaccard** drops below 0.90 (i.e., deviation > 10%).

## How to run

- Default (fast, reuses WAV cache): `bun run scripts/classify-speed-journey.ts`
- Include render cost (slower, uses a fresh WAV cache per run): `bun run scripts/classify-speed-journey.ts --include-render`
- To measure run-to-run variance: add `--repeats 2` (or higher).

## Results

| Run | introSkipSec | maxClassifySec | analysisSampleRate | maxRenderSec | includeRender | elapsedSec | meanJaccardPct | minJaccardPct | meanRecallPct | minRecallPct |
| --- | -----------: | ------------: | -----------------: | ----------: | ------------: | ---------: | ------------: | -----------: | -----------: | ----------: |
| baseline | 30 | 15 | 11025 | 45 | true | 500.86 | 20.3 | 5.0 | 31.9 | 9.5 |
| baseline.1 | 30 | 15 | 11025 | 45 | false | 7.87 | 100.0 | 100.0 | 100.0 | 100.0 |
| baseline.2 | 30 | 15 | 11025 | 45 | false | 4.18 | 100.0 | 100.0 | 100.0 | 100.0 |
| r1.1 | 25 | 15 | 11025 | 40 | false | 4.01 | 100.0 | 100.0 | 100.0 | 100.0 |
| r1.2 | 25 | 15 | 11025 | 40 | false | 3.89 | 100.0 | 100.0 | 100.0 | 100.0 |
| r2.1 | 25 | 12 | 11025 | 37 | false | 3.97 | 100.0 | 100.0 | 100.0 | 100.0 |
| r2.2 | 25 | 12 | 11025 | 37 | false | 3.39 | 100.0 | 100.0 | 100.0 | 100.0 |
| r3.1 | 20 | 10 | 11025 | 30 | false | 3.51 | 100.0 | 100.0 | 100.0 | 100.0 |
| r3.2 | 20 | 10 | 11025 | 30 | false | 3.51 | 100.0 | 100.0 | 100.0 | 100.0 |
| r4.1 | 20 | 10 | 8000 | 30 | false | 3.89 | 100.0 | 100.0 | 100.0 | 100.0 |
| r4.2 | 20 | 10 | 8000 | 30 | false | 3.48 | 100.0 | 100.0 | 100.0 | 100.0 |
| r5.1 | 20 | 10 | 5512 | 30 | false | 3.42 | 100.0 | 100.0 | 100.0 | 100.0 |
| r5.2 | 20 | 10 | 5512 | 30 | false | 3.48 | 100.0 | 100.0 | 100.0 | 100.0 |
| baseline.1 | 30 | 15 | 11025 | 45 | false | 585.22 | 25.0 | 5.0 | 37.6 | 9.5 |
| baseline.1 | 30 | 15 | 11025 | 45 | true | 500.13 | 21.9 | 5.0 | 33.8 | 9.5 |
| baseline.1 | 30 | 15 | 11025 | 45 | false | 7.23 | 61.0 | 40.0 | 75.2 | 57.1 |
| baseline.1 | 30 | 15 | 11025 | 45 | false | 7.36 | 61.0 | 40.0 | 75.2 | 57.1 |
| baseline.1 | 30 | 15 | 11025 | 45 | false | 10.49 | 100.0 | 100.0 | 100.0 | 100.0 |
| baseline.2 | 30 | 15 | 11025 | 45 | false | 5.33 | 100.0 | 100.0 | 100.0 | 100.0 |
| r1.1 | 30 | 15 | 8000 | 45 | false | 5.79 | 38.7 | 27.3 | 55.2 | 42.9 |
| baseline.1 | 30 | 15 | 11025 | 45 | false | 8.00 | 100.0 | 100.0 | 100.0 | 100.0 |
| baseline.2 | 30 | 15 | 11025 | 45 | false | 4.51 | 100.0 | 100.0 | 100.0 | 100.0 |
| r1.1 | 30 | 15 | 10000 | 45 | false | 4.37 | 51.0 | 23.5 | 66.2 | 38.1 |
| baseline | 30 | 15 | 11025 | 45 | true | 530.37 | 100.0 | 100.0 | 100.0 | 100.0 |
| r1 | 25 | 15 | 11025 | 40 | true | 562.89 | 49.8 | 31.3 | 65.7 | 47.6 |
