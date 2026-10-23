# Methodology 4 validation

This records listener-relevant ROM compatibility validation for PR #109. It is
separate from the historical exact-equality/native audit evidence.

## Scope

HVSC 85: 61,157 files and 87,868 subtunes. The qualified pilot is the canonical
567-subtune selection, under the shared 5% ledger ceiling. A completed pilot is
not a completed full census. Unmeasured rows remain explicitly pending.

The audited engine is the exact `libsidplayfp-wasm` 1.1.1 alias. It retains the
classifier's separate dependency. The consumer must zero absent banks and use
the tested engine, model and playback horizon.

## Completed validation

- `bun run build`: passed.
- Strict TypeScript check of every ROM-audit script: passed.
- Package check and shell syntax check: passed.
- Focused controls include missing/changed/quiet melody, short/late sounds,
  stereo loss, silent writes, phase/DC shifts, sawtooth/noise, dense digi timing,
  fallback SID model scope and complete-pilot qualification.
- Source-bound qualification completed: complete canonical pilot, decision
  regression, fresh-process reproducibility, three focused runs (82 pass each)
  and three full repository suites (2,958 pass each), all 0 fail / 0 skip.

The 16-hour target is for the 14600K. This development host is a 6700K. A benchmark
from this machine does not prove another machine's runtime; the executing machine
must pass the corpus-weighted 15-hour census gate, including its 15% margin.

## Measured throughput

The [portable benchmark report](hvsc-rom-benchmark-4.json) retains all 80 job
measurements, population weights, source/engine identities and the original raw
report checksum. Only the HVSC root prefix was removed from job paths.

On the loaded 6700K with seven workers: 46.811 aggregate horizon-seconds/second;
62.523 population-weighted hours, 71.902 hours including the 15% margin. These
are estimates for this machine. Passing the configured 15-hour gate on a 14600K
requires about 4.8 times this measured throughput; no target-machine measurement
is claimed.

The final canonical pilot completed 567 subtunes in 1,592.253 seconds with zero
failed jobs, 113 matching reference repeats and peak worker RSS 188 MB. There
were no unknown measured decisions for masks 0/3. Mask 0: 399 compatible / 168
incompatible; mask 3: 567 compatible. The pilot deliberately oversamples unusual
programs; its incompatibility fraction must not be extrapolated to all HVSC.
The maintained snapshot contains 567 measured and 87,301 pending subtunes.

## Qualification attestation

Source identity: `6d8fbd169fc69cb0bac600fbda560812988b9e0a7383e683bd73526ec98581f7`.

Decision regression digest: `517d199c97ed82da1e513a039831f7ba6e99b9c3b782859f1c9900fe57d13ef6`.
Fresh-process reproducibility matched 5 pilot records.
`stage-status.ts harden workspace/rom-audit-hardening` reports `done`.

Literal terminal output from the qualification runner:

```text
[harden] Full suite run 1: 2958 pass, 0 fail, 0 skip
[harden] Full suite run 2: 2958 pass, 0 fail, 0 skip
[harden] Full suite run 3: 2958 pass, 0 fail, 0 skip
```

The following are the literal Bun per-batch summaries from those same three
complete `bun run test` invocations; no failing batch or opt-in test was omitted.

### Full suite run 1

```text
 9 pass
 0 fail
 1 pass
 0 fail
 3 pass
 0 fail
 3 pass
 0 fail
 2 pass
 0 fail
 21 pass
 0 fail
 20 pass
 0 fail
 3 pass
 0 fail
 2 pass
 0 fail
 10 pass
 0 fail
 1 pass
 0 fail
 8 pass
 0 fail
 2 pass
 0 fail
 4 pass
 0 fail
 13 pass
 0 fail
 15 pass
 0 fail
 4 pass
 0 fail
 2 pass
 0 fail
 23 pass
 0 fail
 2 pass
 0 fail
 6 pass
 0 fail
 12 pass
 0 fail
 3 pass
 0 fail
 4 pass
 0 fail
 4 pass
 0 fail
 4 pass
 0 fail
 1 pass
 0 fail
 11 pass
 0 fail
 45 pass
 0 fail
 17 pass
 0 fail
 3 pass
 0 fail
 5 pass
 0 fail
 3 pass
 0 fail
 8 pass
 0 fail
 7 pass
 0 fail
 17 pass
 0 fail
 5 pass
 0 fail
 22 pass
 0 fail
 11 pass
 0 fail
 32 pass
 0 fail
 2 pass
 0 fail
 5 pass
 0 fail
 13 pass
 0 fail
 3 pass
 0 fail
 15 pass
 0 fail
 5 pass
 0 fail
 6 pass
 0 fail
 15 pass
 0 fail
 2 pass
 0 fail
 10 pass
 0 fail
 2 pass
 0 fail
 206 pass
 0 fail
 247 pass
 0 fail
 188 pass
 0 fail
 101 pass
 0 fail
 26 pass
 0 fail
 92 pass
 0 fail
 206 pass
 0 fail
 233 pass
 0 fail
 10 pass
 0 fail
 66 pass
 0 fail
 105 pass
 0 fail
 128 pass
 0 fail
 123 pass
 0 fail
 122 pass
 0 fail
 97 pass
 0 fail
 150 pass
 0 fail
 159 pass
 0 fail
 122 pass
 0 fail
 82 pass
 0 fail
 1 pass
 0 fail
 37 pass
 0 fail
 11 pass
 0 fail
```

### Full suite run 2

```text
 9 pass
 0 fail
 1 pass
 0 fail
 3 pass
 0 fail
 3 pass
 0 fail
 2 pass
 0 fail
 21 pass
 0 fail
 20 pass
 0 fail
 3 pass
 0 fail
 2 pass
 0 fail
 10 pass
 0 fail
 1 pass
 0 fail
 8 pass
 0 fail
 2 pass
 0 fail
 4 pass
 0 fail
 13 pass
 0 fail
 15 pass
 0 fail
 4 pass
 0 fail
 2 pass
 0 fail
 23 pass
 0 fail
 2 pass
 0 fail
 6 pass
 0 fail
 12 pass
 0 fail
 3 pass
 0 fail
 4 pass
 0 fail
 4 pass
 0 fail
 4 pass
 0 fail
 1 pass
 0 fail
 11 pass
 0 fail
 45 pass
 0 fail
 17 pass
 0 fail
 3 pass
 0 fail
 5 pass
 0 fail
 3 pass
 0 fail
 8 pass
 0 fail
 7 pass
 0 fail
 17 pass
 0 fail
 5 pass
 0 fail
 22 pass
 0 fail
 11 pass
 0 fail
 32 pass
 0 fail
 2 pass
 0 fail
 5 pass
 0 fail
 13 pass
 0 fail
 3 pass
 0 fail
 15 pass
 0 fail
 5 pass
 0 fail
 6 pass
 0 fail
 15 pass
 0 fail
 2 pass
 0 fail
 10 pass
 0 fail
 2 pass
 0 fail
 206 pass
 0 fail
 247 pass
 0 fail
 188 pass
 0 fail
 101 pass
 0 fail
 26 pass
 0 fail
 92 pass
 0 fail
 206 pass
 0 fail
 233 pass
 0 fail
 10 pass
 0 fail
 66 pass
 0 fail
 105 pass
 0 fail
 128 pass
 0 fail
 123 pass
 0 fail
 122 pass
 0 fail
 97 pass
 0 fail
 150 pass
 0 fail
 159 pass
 0 fail
 122 pass
 0 fail
 82 pass
 0 fail
 1 pass
 0 fail
 37 pass
 0 fail
 11 pass
 0 fail
```

### Full suite run 3

```text
 9 pass
 0 fail
 1 pass
 0 fail
 3 pass
 0 fail
 3 pass
 0 fail
 2 pass
 0 fail
 21 pass
 0 fail
 20 pass
 0 fail
 3 pass
 0 fail
 2 pass
 0 fail
 10 pass
 0 fail
 1 pass
 0 fail
 8 pass
 0 fail
 2 pass
 0 fail
 4 pass
 0 fail
 13 pass
 0 fail
 15 pass
 0 fail
 4 pass
 0 fail
 2 pass
 0 fail
 23 pass
 0 fail
 2 pass
 0 fail
 6 pass
 0 fail
 12 pass
 0 fail
 3 pass
 0 fail
 4 pass
 0 fail
 4 pass
 0 fail
 4 pass
 0 fail
 1 pass
 0 fail
 11 pass
 0 fail
 45 pass
 0 fail
 17 pass
 0 fail
 3 pass
 0 fail
 5 pass
 0 fail
 3 pass
 0 fail
 8 pass
 0 fail
 7 pass
 0 fail
 17 pass
 0 fail
 5 pass
 0 fail
 22 pass
 0 fail
 11 pass
 0 fail
 32 pass
 0 fail
 2 pass
 0 fail
 5 pass
 0 fail
 13 pass
 0 fail
 3 pass
 0 fail
 15 pass
 0 fail
 5 pass
 0 fail
 6 pass
 0 fail
 15 pass
 0 fail
 2 pass
 0 fail
 10 pass
 0 fail
 2 pass
 0 fail
 206 pass
 0 fail
 247 pass
 0 fail
 188 pass
 0 fail
 101 pass
 0 fail
 26 pass
 0 fail
 92 pass
 0 fail
 206 pass
 0 fail
 233 pass
 0 fail
 10 pass
 0 fail
 66 pass
 0 fail
 105 pass
 0 fail
 128 pass
 0 fail
 123 pass
 0 fail
 122 pass
 0 fail
 97 pass
 0 fail
 150 pass
 0 fail
 159 pass
 0 fail
 122 pass
 0 fail
 82 pass
 0 fail
 1 pass
 0 fail
 37 pass
 0 fail
 11 pass
 0 fail
```
