# HVSC ROM audit validation

Research base: SIDFlow `d893e32`, branch `research/hvsc-rom-requirements`.
Bun 1.3.1; Node v24.11.0; g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0.
A fresh build in an independent cache reproduces the measured renderer binary
**byte for byte**, SHA-256
`7c4494076d6fcb26f7d355314bf1c467f7ec68c159efe61e98def4451ee11123`.
Native release build uses `-O3 -DNDEBUG`; sanitizer builds use
`-O1 -g -fsanitize=address -fno-omit-frame-pointer`.

## Measurement verification

- Exact full-run resume re-read all 61,157 SID files and ROM inputs, matched
  all paths/complete-file MD5s/subtune counts to HVSC 85 Songlengths.md5 and
  verified the existing manifest; 87,868 unique rows, zero pending jobs.
- Publication checks all three controlled runs, exact archive/binary/document
  identities, complete unique coverage, finite fields, adaptive minimum
  durations, and every derived measurement against its own KERNAL-state source.
  All three manifests agree on corpus, ROMs, binary, source and protocol; none
  has a preliminary seed. See [portable results and hashes](hvsc-rom-catalogue/results.json).
- Catalogue validation: 59,631 distinct file sections, 85,687 subtune rows,
  200 detail pages. The 1,526 exclusively identical non-BASIC files omitted
  from the affected catalogue account for the remaining 2,181 subtunes.
  The category counts sum to the complete denominator, 87,868.
- `verify-native.ts`: all **24** native/WASM controls pass, covering six
  inputs and all four ROM combinations, including PSID, RSID, BASIC,
  multi-SID and an explicit non-default subtune. PCM is bit-identical and
  write counts match. This is targeted parity, not WASM execution of the full census.
- `native-regression.ts` against ASAN: synthetic PAL, NTSC, RSID busy-loop
  and the required real Justincase input complete every configuration and
  repeat reference identically at 256-event pulls. Restoring only the old
  20,000-event pull (plus comments) reproduces the ASAN heap-buffer overflow.
- Independent standalone 1.1.0 / 3.1.1 ASAN control, 48 kHz stereo: 256
  completes (`Completed 192002 samples`); 20,000 fails at SID.cpp:45, a
  two-byte write immediately after the 1,920-byte allocation. The standalone
  loop can overshoot the requested endpoint by one frame; the audit trims
  the final PCM to the exact requested size.
- `check-large-pulls.ts` on shipped package 1.1.0: all eight isolated processes
  return full sample arrays; SIDLite differs across pull sizes at both 8/48 kHz,
  while reSIDfp matches. Earlier 1.0.1 logs show the same distinction. A full
  sample count is not a correctness certificate.
- `check-fallback.ts`: six current-package engine/input comparisons, ten seconds
  each, retain PCM/sequence hashes and sustained activity (one-second RMS bins
  and first/last SID-write cycles). SIDLite and reSIDfp both fail to restore
  128 Byte Blues without ROMs (1,176 writes versus initialization-only one).
- `check-commander.ts`: real dispatcher/core with installed 1.1.0 returns
  opened/romRequired false for both 1,177-write reference and one-write no-ROM
  result. Host-process evidence only; no phone or speaker result is claimed.

## Build and script checks

`bun run build` passed (frozen lockfile install, no dependency changes, `tsc -b`).
Strict script typecheck passed:

```sh
bunx tsc --noEmit --strict --module ESNext --moduleResolution bundler \
  --target ES2022 --types bun-types --skipLibCheck --allowImportingTsExtensions \
  scripts/rom-audit/*.ts
```

The prior `--types bun` invocation failed because the installed declaration package
is `bun-types`; it is not evidence of successful checking. The publication script's
Map inference errors found by the valid check were corrected with an explicit
key/value type and tuple. No production dependency was changed. The final catalogue formatting removes
trailing whitespace and separates metadata paragraphs; publication, focused tests
and strict script typecheck were rechecked after that formatting adjustment.

Focused audit tests' literal final output:

```text
bun test v1.3.1 (89fa0f34)

packages/sidflow-common/test/rom-audit.test.ts:
(pass) ROM audit evidence boundaries > does not equate an oscillator-phase PCM difference with changed SID writes [1.00ms]
(pass) ROM audit evidence boundaries > attributes missing KERNAL to the BASIC-only experiment
(pass) ROM audit evidence boundaries > attributes missing BASIC to the KERNAL-only experiment [1.00ms]
(pass) ROM audit evidence boundaries > distinguishes individual dependencies from combined-removal interaction
(pass) ROM audit evidence boundaries > does not count quiet or failed references as ROM-independent
(pass) ROM audit evidence boundaries > requires an identical repeated reference before attribution
(pass) ROM audit evidence boundaries > keeps startup clicks and a single initialization write inconclusive
(pass) ROM audit evidence boundaries > detects stopped sequences, timing drift and emulation errors
(pass) ROM audit evidence boundaries > preserves STIL subtune notes and distinguishes composers from cover artists
(pass) ROM audit evidence boundaries > escapes CSV metadata and uses explicit subtune denominators [1.00ms]
(pass) ROM audit evidence boundaries > does not mistake the PSID PlaySID-specific flag for the RSID BASIC flag [1.00ms]
(pass) ROM audit evidence boundaries > treats static ROM-range patterns and indirect operands only as candidates, including data
(pass) ROM audit evidence boundaries > requires unique complete subtune coverage and adaptive durations before publication [1.00ms]
(pass) ROM audit evidence boundaries > requires BASIC zero-read equivalence independently in each KERNAL state [1.00ms]

 14 pass
 0 fail
 45 expect() calls
Ran 14 tests across 1 file. [57.00ms]
```

The tests cover attribution direction, combined-removal interaction, unstable and
quiet/error references, initialization-only activity, thresholds, metadata/CSV,
BASIC flag interpretation, static-pattern uncertainty, publication completeness,
adaptive durations and independent zero-read provenance. ASAN's deliberately
unsafe real-input negative control fails without containment; it is not counted
as an unexpected failing repository test.

## Earlier failed repository run

`full-1.log` failed the Super Mario classification-stability throughput assertion:
received 2134.2916666666665 ms/record, allowed 1995.9895833333333. It ran while the
CPU-intensive corpus audit was active. The audit touches no classification engine
implementation, and later full runs were performed with the audit idle. This
supports scheduling contention as a plausible explanation, not a controlled proof
of causality. The assertion was not weakened or skipped and no unrelated fix was
made. Negative-path tests emit expected warning/error diagnostics; none was
suppressed to make validation pass.

## Full repository runs

Each `bun run test:ci` invokes the repository's batched unit/contract/integration
coverage runner. Its 72 coverage batches and one existing no-coverage worker/WASM
batch must all succeed. This is not a browser or device E2E run. The existing
300-file persona materialization test is opt-in via
`SIDFLOW_ENABLE_NETWORK_E2E_MATERIALIZATION` and remains skipped by the standard
command; no new skip was introduced. Raw logs remain in the local validation
workspace, and the literal per-batch summaries are retained below.

### Full run 1

Computed sum across literal batch summaries: **2888 pass, 0 fail, 1 existing opt-in skip**. Command exited 0.

```text
 9 pass
 0 fail
 574 expect() calls
Ran 9 tests across 1 file. [13.00ms]
 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file. [675.00ms]
 3 pass
 0 fail
 8 expect() calls
Ran 3 tests across 1 file. [271.00ms]
 3 pass
 0 fail
 30 expect() calls
Ran 3 tests across 1 file. [738.00ms]
 2 pass
 0 fail
 5 expect() calls
Ran 2 tests across 1 file. [20.00ms]
 21 pass
 0 fail
 45 expect() calls
Ran 21 tests across 1 file. [242.00ms]
 20 pass
 0 fail
 50 expect() calls
Ran 20 tests across 1 file. [676.00ms]
 3 pass
 0 fail
 63 expect() calls
Ran 3 tests across 1 file. [257.00ms]
 2 pass
 0 fail
 16 expect() calls
Ran 2 tests across 1 file. [3.00s]
 10 pass
 0 fail
 20 expect() calls
Ran 10 tests across 1 file. [401.00ms]
 1 pass
 0 fail
 11 expect() calls
Ran 1 test across 1 file. [899.00ms]
 7 pass
 0 fail
 52 expect() calls
Ran 7 tests across 1 file. [1.89s]
 2 pass
 0 fail
 18 expect() calls
Ran 2 tests across 1 file. [1293.00ms]
 4 pass
 0 fail
 78 expect() calls
Ran 4 tests across 1 file. [1.53s]
 13 pass
 0 fail
 40 expect() calls
Ran 13 tests across 1 file. [296.00ms]
 15 pass
 0 fail
 19 expect() calls
Ran 15 tests across 1 file. [107.00ms]
 4 pass
 0 fail
 15 expect() calls
Ran 4 tests across 1 file. [727.00ms]
 2 pass
 0 fail
 85 expect() calls
Ran 2 tests across 1 file. [1138.00ms]
 23 pass
 0 fail
 113 expect() calls
Ran 23 tests across 1 file. [803.00ms]
 2 pass
 0 fail
 22 expect() calls
Ran 2 tests across 1 file. [1254.00ms]
 6 pass
 0 fail
 8 expect() calls
Ran 6 tests across 1 file. [630.00ms]
 12 pass
 0 fail
 33 expect() calls
Ran 12 tests across 1 file. [278.00ms]
 3 pass
 0 fail
 14 expect() calls
Ran 3 tests across 1 file. [709.00ms]
 4 pass
 0 fail
 8 expect() calls
Ran 4 tests across 1 file. [744.00ms]
 4 pass
 0 fail
 39 expect() calls
Ran 4 tests across 1 file. [1417.00ms]
 4 pass
 0 fail
 23 expect() calls
Ran 4 tests across 1 file. [1.86s]
 1 pass
 0 fail
 12 expect() calls
Ran 1 test across 1 file. [5.51s]
 11 pass
 0 fail
 80269 expect() calls
Ran 11 tests across 1 file. [270.00ms]
 45 pass
 0 fail
 78 expect() calls
Ran 45 tests across 1 file. [252.00ms]
 17 pass
 0 fail
 29 expect() calls
Ran 17 tests across 1 file. [1297.00ms]
 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [461.00ms]
 5 pass
 0 fail
 14 expect() calls
Ran 5 tests across 1 file. [345.00ms]
 3 pass
 0 fail
 12 expect() calls
Ran 3 tests across 1 file. [984.00ms]
 8 pass
 0 fail
 20 expect() calls
Ran 8 tests across 1 file. [379.00ms]
 7 pass
 0 fail
 41 expect() calls
Ran 7 tests across 1 file. [886.00ms]
 17 pass
 0 fail
 128 expect() calls
Ran 17 tests across 1 file. [145.00ms]
 5 pass
 0 fail
 28 expect() calls
Ran 5 tests across 1 file. [24.00ms]
 22 pass
 0 fail
 165 expect() calls
Ran 22 tests across 1 file. [74.00ms]
 11 pass
 0 fail
 221 expect() calls
Ran 11 tests across 1 file. [242.00ms]
 32 pass
 0 fail
 99 expect() calls
Ran 32 tests across 1 file. [1483.00ms]
 2 pass
 0 fail
 45 expect() calls
Ran 2 tests across 1 file. [76.69s]
 5 pass
 0 fail
 76 expect() calls
Ran 5 tests across 1 file. [1061.00ms]
 13 pass
 0 fail
 21 expect() calls
Ran 13 tests across 1 file. [251.00ms]
 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [37.00ms]
 15 pass
 0 fail
 44 expect() calls
Ran 15 tests across 1 file. [919.00ms]
 5 pass
 0 fail
 31 expect() calls
Ran 5 tests across 1 file. [738.00ms]
 6 pass
 0 fail
 352811 expect() calls
Ran 6 tests across 1 file. [446.00ms]
 15 pass
 0 fail
 41 expect() calls
Ran 15 tests across 1 file. [319.00ms]
 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [306.00ms]
 10 pass
 0 fail
 30 expect() calls
Ran 10 tests across 1 file. [2.50s]
 2 pass
 0 fail
 8 expect() calls
Ran 2 tests across 1 file. [332.00ms]
 206 pass
 0 fail
 385 expect() calls
Ran 206 tests across 16 files. [3.39s]
 248 pass
 0 fail
 815 expect() calls
Ran 248 tests across 16 files. [1160.00ms]
 166 pass
 0 fail
 14974 expect() calls
Ran 166 tests across 16 files. [13.68s]
 54 pass
 0 fail
 129 expect() calls
Ran 54 tests across 4 files. [3.46s]
 26 pass
 0 fail
 74 expect() calls
Ran 26 tests across 5 files. [300.00ms]
 92 pass
 0 fail
 183 expect() calls
Ran 92 tests across 5 files. [361.00ms]
 206 pass
 0 fail
 2572 expect() calls
Ran 206 tests across 10 files. [3.98s]
 233 pass
 0 fail
 551 expect() calls
Ran 233 tests across 9 files. [20.08s]
 10 pass
 0 fail
 17 expect() calls
Ran 10 tests across 1 file. [316.00ms]
 66 pass
 0 fail
 5739 expect() calls
Ran 66 tests across 7 files. [1218.00ms]
 105 pass
 0 fail
 303 expect() calls
Ran 105 tests across 10 files. [520.00ms]
 128 pass
 0 fail
 419 expect() calls
Ran 128 tests across 10 files. [1.63s]
 123 pass
 0 fail
 341 expect() calls
Ran 123 tests across 10 files. [1.77s]
 122 pass
 0 fail
 225 expect() calls
Ran 122 tests across 10 files. [1018.00ms]
 97 pass
 0 fail
 269 expect() calls
Ran 97 tests across 10 files. [476.00ms]
 150 pass
 0 fail
 287 expect() calls
Ran 150 tests across 10 files. [927.00ms]
 159 pass
 0 fail
 1011 expect() calls
Ran 159 tests across 10 files. [876.00ms]
 122 pass
 0 fail
 944 expect() calls
Ran 122 tests across 10 files. [443.00ms]
 82 pass
 0 fail
 182 expect() calls
Ran 82 tests across 6 files. [147.00ms]
 0 pass
 1 skip
 0 fail
Ran 1 test across 1 file. [716.00ms]
 37 pass
 0 fail
 59744 expect() calls
Ran 37 tests across 2 files. [330.00ms]
 11 pass
 0 fail
 38 expect() calls
Ran 11 tests across 2 files. [14.18s]
[coverage-batches] Wrote merged unit coverage to coverage/lcov.info
```

### Full run 2

Computed sum across literal batch summaries: **2888 pass, 0 fail, 1 existing opt-in skip**. Command exited 0.

```text
 9 pass
 0 fail
 574 expect() calls
Ran 9 tests across 1 file. [13.00ms]
 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file. [798.00ms]
 3 pass
 0 fail
 8 expect() calls
Ran 3 tests across 1 file. [241.00ms]
 3 pass
 0 fail
 30 expect() calls
Ran 3 tests across 1 file. [766.00ms]
 2 pass
 0 fail
 5 expect() calls
Ran 2 tests across 1 file. [22.00ms]
 21 pass
 0 fail
 45 expect() calls
Ran 21 tests across 1 file. [364.00ms]
 20 pass
 0 fail
 50 expect() calls
Ran 20 tests across 1 file. [857.00ms]
 3 pass
 0 fail
 63 expect() calls
Ran 3 tests across 1 file. [318.00ms]
 2 pass
 0 fail
 16 expect() calls
Ran 2 tests across 1 file. [2.78s]
 10 pass
 0 fail
 20 expect() calls
Ran 10 tests across 1 file. [337.00ms]
 1 pass
 0 fail
 11 expect() calls
Ran 1 test across 1 file. [923.00ms]
 7 pass
 0 fail
 52 expect() calls
Ran 7 tests across 1 file. [1.55s]
 2 pass
 0 fail
 18 expect() calls
Ran 2 tests across 1 file. [860.00ms]
 4 pass
 0 fail
 78 expect() calls
Ran 4 tests across 1 file. [1034.00ms]
 13 pass
 0 fail
 40 expect() calls
Ran 13 tests across 1 file. [263.00ms]
 15 pass
 0 fail
 19 expect() calls
Ran 15 tests across 1 file. [95.00ms]
 4 pass
 0 fail
 15 expect() calls
Ran 4 tests across 1 file. [630.00ms]
 2 pass
 0 fail
 85 expect() calls
Ran 2 tests across 1 file. [979.00ms]
 23 pass
 0 fail
 113 expect() calls
Ran 23 tests across 1 file. [952.00ms]
 2 pass
 0 fail
 22 expect() calls
Ran 2 tests across 1 file. [1137.00ms]
 6 pass
 0 fail
 8 expect() calls
Ran 6 tests across 1 file. [619.00ms]
 12 pass
 0 fail
 33 expect() calls
Ran 12 tests across 1 file. [235.00ms]
 3 pass
 0 fail
 14 expect() calls
Ran 3 tests across 1 file. [603.00ms]
 4 pass
 0 fail
 8 expect() calls
Ran 4 tests across 1 file. [645.00ms]
 4 pass
 0 fail
 39 expect() calls
Ran 4 tests across 1 file. [689.00ms]
 4 pass
 0 fail
 23 expect() calls
Ran 4 tests across 1 file. [1426.00ms]
 1 pass
 0 fail
 12 expect() calls
Ran 1 test across 1 file. [4.91s]
 11 pass
 0 fail
 80269 expect() calls
Ran 11 tests across 1 file. [289.00ms]
 45 pass
 0 fail
 78 expect() calls
Ran 45 tests across 1 file. [273.00ms]
 17 pass
 0 fail
 29 expect() calls
Ran 17 tests across 1 file. [948.00ms]
 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [395.00ms]
 5 pass
 0 fail
 14 expect() calls
Ran 5 tests across 1 file. [274.00ms]
 3 pass
 0 fail
 12 expect() calls
Ran 3 tests across 1 file. [745.00ms]
 8 pass
 0 fail
 20 expect() calls
Ran 8 tests across 1 file. [263.00ms]
 7 pass
 0 fail
 41 expect() calls
Ran 7 tests across 1 file. [698.00ms]
 17 pass
 0 fail
 128 expect() calls
Ran 17 tests across 1 file. [138.00ms]
 5 pass
 0 fail
 28 expect() calls
Ran 5 tests across 1 file. [16.00ms]
 22 pass
 0 fail
 165 expect() calls
Ran 22 tests across 1 file. [38.00ms]
 11 pass
 0 fail
 221 expect() calls
Ran 11 tests across 1 file. [237.00ms]
 32 pass
 0 fail
 99 expect() calls
Ran 32 tests across 1 file. [1478.00ms]
 2 pass
 0 fail
 45 expect() calls
Ran 2 tests across 1 file. [76.67s]
 5 pass
 0 fail
 76 expect() calls
Ran 5 tests across 1 file. [1013.00ms]
 13 pass
 0 fail
 21 expect() calls
Ran 13 tests across 1 file. [215.00ms]
 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [24.00ms]
 15 pass
 0 fail
 44 expect() calls
Ran 15 tests across 1 file. [857.00ms]
 5 pass
 0 fail
 31 expect() calls
Ran 5 tests across 1 file. [696.00ms]
 6 pass
 0 fail
 352811 expect() calls
Ran 6 tests across 1 file. [375.00ms]
 15 pass
 0 fail
 41 expect() calls
Ran 15 tests across 1 file. [281.00ms]
 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [217.00ms]
 10 pass
 0 fail
 30 expect() calls
Ran 10 tests across 1 file. [2.36s]
 2 pass
 0 fail
 8 expect() calls
Ran 2 tests across 1 file. [227.00ms]
 206 pass
 0 fail
 385 expect() calls
Ran 206 tests across 16 files. [2.29s]
 248 pass
 0 fail
 815 expect() calls
Ran 248 tests across 16 files. [924.00ms]
 166 pass
 0 fail
 14974 expect() calls
Ran 166 tests across 16 files. [11.14s]
 54 pass
 0 fail
 129 expect() calls
Ran 54 tests across 4 files. [3.28s]
 26 pass
 0 fail
 74 expect() calls
Ran 26 tests across 5 files. [360.00ms]
 92 pass
 0 fail
 183 expect() calls
Ran 92 tests across 5 files. [325.00ms]
 206 pass
 0 fail
 2572 expect() calls
Ran 206 tests across 10 files. [3.42s]
 233 pass
 0 fail
 551 expect() calls
Ran 233 tests across 9 files. [15.79s]
 10 pass
 0 fail
 17 expect() calls
Ran 10 tests across 1 file. [255.00ms]
 66 pass
 0 fail
 5739 expect() calls
Ran 66 tests across 7 files. [923.00ms]
 105 pass
 0 fail
 309 expect() calls
Ran 105 tests across 10 files. [391.00ms]
 128 pass
 0 fail
 419 expect() calls
Ran 128 tests across 10 files. [1467.00ms]
 123 pass
 0 fail
 341 expect() calls
Ran 123 tests across 10 files. [1.79s]
 122 pass
 0 fail
 225 expect() calls
Ran 122 tests across 10 files. [910.00ms]
 97 pass
 0 fail
 269 expect() calls
Ran 97 tests across 10 files. [403.00ms]
 150 pass
 0 fail
 287 expect() calls
Ran 150 tests across 10 files. [898.00ms]
 159 pass
 0 fail
 1011 expect() calls
Ran 159 tests across 10 files. [818.00ms]
 122 pass
 0 fail
 944 expect() calls
Ran 122 tests across 10 files. [377.00ms]
 82 pass
 0 fail
 182 expect() calls
Ran 82 tests across 6 files. [139.00ms]
 0 pass
 1 skip
 0 fail
Ran 1 test across 1 file. [578.00ms]
 37 pass
 0 fail
 59744 expect() calls
Ran 37 tests across 2 files. [267.00ms]
 11 pass
 0 fail
 38 expect() calls
Ran 11 tests across 2 files. [13.70s]
[coverage-batches] Wrote merged unit coverage to coverage/lcov.info
```

### Full run 3

Computed sum across literal batch summaries: **2888 pass, 0 fail, 1 existing opt-in skip**. Command exited 0.

```text
 9 pass
 0 fail
 574 expect() calls
Ran 9 tests across 1 file. [16.00ms]
 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file. [816.00ms]
 3 pass
 0 fail
 8 expect() calls
Ran 3 tests across 1 file. [241.00ms]
 3 pass
 0 fail
 30 expect() calls
Ran 3 tests across 1 file. [717.00ms]
 2 pass
 0 fail
 5 expect() calls
Ran 2 tests across 1 file. [16.00ms]
 21 pass
 0 fail
 45 expect() calls
Ran 21 tests across 1 file. [241.00ms]
 20 pass
 0 fail
 50 expect() calls
Ran 20 tests across 1 file. [631.00ms]
 3 pass
 0 fail
 63 expect() calls
Ran 3 tests across 1 file. [250.00ms]
 2 pass
 0 fail
 16 expect() calls
Ran 2 tests across 1 file. [2.56s]
 10 pass
 0 fail
 20 expect() calls
Ran 10 tests across 1 file. [308.00ms]
 1 pass
 0 fail
 11 expect() calls
Ran 1 test across 1 file. [871.00ms]
 7 pass
 0 fail
 52 expect() calls
Ran 7 tests across 1 file. [1472.00ms]
 2 pass
 0 fail
 18 expect() calls
Ran 2 tests across 1 file. [928.00ms]
 4 pass
 0 fail
 78 expect() calls
Ran 4 tests across 1 file. [1060.00ms]
 13 pass
 0 fail
 40 expect() calls
Ran 13 tests across 1 file. [267.00ms]
 15 pass
 0 fail
 19 expect() calls
Ran 15 tests across 1 file. [107.00ms]
 4 pass
 0 fail
 15 expect() calls
Ran 4 tests across 1 file. [664.00ms]
 2 pass
 0 fail
 85 expect() calls
Ran 2 tests across 1 file. [947.00ms]
 23 pass
 0 fail
 113 expect() calls
Ran 23 tests across 1 file. [796.00ms]
 2 pass
 0 fail
 22 expect() calls
Ran 2 tests across 1 file. [1136.00ms]
 6 pass
 0 fail
 8 expect() calls
Ran 6 tests across 1 file. [580.00ms]
 12 pass
 0 fail
 33 expect() calls
Ran 12 tests across 1 file. [264.00ms]
 3 pass
 0 fail
 14 expect() calls
Ran 3 tests across 1 file. [609.00ms]
 4 pass
 0 fail
 8 expect() calls
Ran 4 tests across 1 file. [619.00ms]
 4 pass
 0 fail
 39 expect() calls
Ran 4 tests across 1 file. [736.00ms]
 4 pass
 0 fail
 23 expect() calls
Ran 4 tests across 1 file. [1337.00ms]
 1 pass
 0 fail
 12 expect() calls
Ran 1 test across 1 file. [5.76s]
 11 pass
 0 fail
 80269 expect() calls
Ran 11 tests across 1 file. [250.00ms]
 45 pass
 0 fail
 78 expect() calls
Ran 45 tests across 1 file. [265.00ms]
 17 pass
 0 fail
 29 expect() calls
Ran 17 tests across 1 file. [1020.00ms]
 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [360.00ms]
 5 pass
 0 fail
 14 expect() calls
Ran 5 tests across 1 file. [287.00ms]
 3 pass
 0 fail
 12 expect() calls
Ran 3 tests across 1 file. [727.00ms]
 8 pass
 0 fail
 20 expect() calls
Ran 8 tests across 1 file. [248.00ms]
 7 pass
 0 fail
 41 expect() calls
Ran 7 tests across 1 file. [654.00ms]
 17 pass
 0 fail
 128 expect() calls
Ran 17 tests across 1 file. [134.00ms]
 5 pass
 0 fail
 28 expect() calls
Ran 5 tests across 1 file. [15.00ms]
 22 pass
 0 fail
 165 expect() calls
Ran 22 tests across 1 file. [29.00ms]
 11 pass
 0 fail
 221 expect() calls
Ran 11 tests across 1 file. [218.00ms]
 32 pass
 0 fail
 99 expect() calls
Ran 32 tests across 1 file. [1.51s]
 2 pass
 0 fail
 45 expect() calls
Ran 2 tests across 1 file. [75.84s]
 5 pass
 0 fail
 76 expect() calls
Ran 5 tests across 1 file. [919.00ms]
 13 pass
 0 fail
 21 expect() calls
Ran 13 tests across 1 file. [210.00ms]
 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [25.00ms]
 15 pass
 0 fail
 44 expect() calls
Ran 15 tests across 1 file. [800.00ms]
 5 pass
 0 fail
 31 expect() calls
Ran 5 tests across 1 file. [638.00ms]
 6 pass
 0 fail
 352811 expect() calls
Ran 6 tests across 1 file. [372.00ms]
 15 pass
 0 fail
 41 expect() calls
Ran 15 tests across 1 file. [230.00ms]
 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [246.00ms]
 10 pass
 0 fail
 30 expect() calls
Ran 10 tests across 1 file. [2.35s]
 2 pass
 0 fail
 8 expect() calls
Ran 2 tests across 1 file. [230.00ms]
 206 pass
 0 fail
 385 expect() calls
Ran 206 tests across 16 files. [2.27s]
 248 pass
 0 fail
 815 expect() calls
Ran 248 tests across 16 files. [988.00ms]
 166 pass
 0 fail
 14974 expect() calls
Ran 166 tests across 16 files. [11.34s]
 54 pass
 0 fail
 129 expect() calls
Ran 54 tests across 4 files. [3.31s]
 26 pass
 0 fail
 74 expect() calls
Ran 26 tests across 5 files. [259.00ms]
 92 pass
 0 fail
 183 expect() calls
Ran 92 tests across 5 files. [304.00ms]
 206 pass
 0 fail
 2572 expect() calls
Ran 206 tests across 10 files. [3.17s]
 233 pass
 0 fail
 551 expect() calls
Ran 233 tests across 9 files. [15.37s]
 10 pass
 0 fail
 17 expect() calls
Ran 10 tests across 1 file. [271.00ms]
 66 pass
 0 fail
 5739 expect() calls
Ran 66 tests across 7 files. [915.00ms]
 105 pass
 0 fail
 309 expect() calls
Ran 105 tests across 10 files. [353.00ms]
 128 pass
 0 fail
 419 expect() calls
Ran 128 tests across 10 files. [1438.00ms]
 123 pass
 0 fail
 341 expect() calls
Ran 123 tests across 10 files. [1.67s]
 122 pass
 0 fail
 225 expect() calls
Ran 122 tests across 10 files. [905.00ms]
 97 pass
 0 fail
 269 expect() calls
Ran 97 tests across 10 files. [399.00ms]
 150 pass
 0 fail
 287 expect() calls
Ran 150 tests across 10 files. [819.00ms]
 159 pass
 0 fail
 1011 expect() calls
Ran 159 tests across 10 files. [839.00ms]
 122 pass
 0 fail
 944 expect() calls
Ran 122 tests across 10 files. [384.00ms]
 82 pass
 0 fail
 182 expect() calls
Ran 82 tests across 6 files. [144.00ms]
 0 pass
 1 skip
 0 fail
Ran 1 test across 1 file. [562.00ms]
 37 pass
 0 fail
 59744 expect() calls
Ran 37 tests across 2 files. [373.00ms]
 11 pass
 0 fail
 38 expect() calls
Ran 11 tests across 2 files. [13.40s]
[coverage-batches] Wrote merged unit coverage to coverage/lcov.info
```

## Final scope

Markdown links, counts and file/subtune section totals were checked. No ROM,
SID binary, PCM/audio, native binary, core dump or raw corpus checkpoint is
included in the research commit. The published catalogue is the requested
metadata/evidence report. The unrelated pre-existing deletion of tracked `core`
is left unstaged, and the other checkouts' changes are preserved.

No application UI was changed: browser/device suites, Android builds/deployment
and screenshot regeneration are outside this local-emulator research scope.
The three confirmed defect issues remain open, as stated in the main report;
this research result is not an assertion that those product defects are fixed.
