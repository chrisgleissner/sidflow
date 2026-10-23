# Methodology 2 publication snapshot

This records the validation-phase snapshot before unattended continuation. The current `manifest.json` remains authoritative if the continued run has subsequently republished these artifacts. At this snapshot there is a complete inventory with **incomplete full-duration measurement coverage**.

HVSC 85: 61,157 files, 87,868 subtunes; 763 subtunes measured, 87,105 pending. The research gzip has one JSONL record for every subtune. No pending measurement is treated as equality.

| ROM mask | Compatible | Incompatible | Unknown |
|---:|---:|---:|---:|
| 0 | 0 | 0 | 87868 |
| 1 | 1 | 0 | 87867 |
| 2 | 0 | 0 | 87868 |
| 3 | 2 | 0 | 87866 |
| 4 | 0 | 0 | 87868 |
| 5 | 1 | 0 | 87867 |
| 6 | 0 | 0 | 87868 |
| 7 | 2 | 0 | 87866 |

Mask bits: KERNAL=1, BASIC=2, CHARGEN=4. Strict no-ROM policy denies all 87,868 subtunes. These are eligibility counts; the zero incompatibility counts do **not** mean that missing ROMs work. Most experiments have no full-duration WASM qualification, or have not run at all.

Observed horizon totals: 15,193.611 subtune-seconds (nine renders per measured subtune). 708 subtunes received 10s because their documented duration plus margin fits inside 10s; the other 55 received 23–559s, including fractional metadata durations. No horizon was shortened to 10s. Full scheduled horizon total is about 10,176,145.245 subtune-seconds; all release tokens parsed as positive durations. Loop recurrence and interactivity remain unproven.

6,104 matrix outcomes are present; 696,840 remain unmeasured. Five native mask-0 and five mask-4 experiments reported execution errors, but lack exact-case WASM certification and therefore remain unknown. There are no newly production-confirmed dependency totals for the whole corpus. See the unchanged historical catalogue for earlier bounded sensitivity counts.

The two timed corpus passes took 205.526s and 181.051s for 55 and 708 new subtunes respectively (0.268 and 3.911 subtunes/s). They used different horizon distributions, so these rates are not an optimization speedup claim. Together they processed about 354 emulated seconds per wall second across six workers. Extrapolating that measured rate to the remaining horizon suggests roughly 72 hours; it is an estimate, not completed work. A separate 23s BASIC matrix benchmark used 4.25s wall / 4.08s user CPU and 6,480 KiB maximum RSS. This is a small-case measurement, not the long-duration memory bound.

The passes stopped at configured 180s scheduling budgets and drained active jobs. No environmental failure forced a stop; the outstanding census remains work to do. Valid resumable checkpoints, headers, horizon tokens, parity certificate and invocation coverage are preserved in `workspace/rom-audit-v2/`. This publication is intentionally conservative and is not ready as a broadly permissive production catalogue.

Artifacts:

- `research.jsonl.gz`: deterministic gzip JSONL, complete per-subtune inventory/evidence/uncertainty.
- `deny-list.json`: deterministic compact SHA-256/subtune decision bitmasks.
- `manifest.json`: versioned identities, checksums, counts and coverage.
- `parity.json`: 104 exact-case native/WASM hash/count controls, with ROM provenance.

See [methodology, limitations and exact resume commands](../../hvsc-rom-production.md). No C64 Commander changes were made.
