# Running the full HVSC 85 ROM census on another machine

## Summary

`scripts/rom-audit/run-full.sh` runs the complete methodology 3 census
([design](hvsc-rom-production.md)) from a fresh clone: it sets up the inputs, checks that the
sources carry an architect approval, measures the reviewed pilot, qualifies the sources on
this machine, renders all 87,868 subtunes on the shipping WASM engine (`libsidplayfp-wasm`
1.1.0, SIDLite by default) and publishes the dataset. Every stage checkpoints, so the
identical command resumes after an interruption. **Expect days of CPU time**: about 12 days on the
8-thread development machine (an i7-6700K), so a machine with many fast cores is worthwhile.

## One-liner

```sh
git clone git@github.com:chrisgleissner/sidflow.git && cd sidflow \
  && git checkout <branch-or-tag-given-to-you> && bash scripts/rom-audit/run-full.sh 2>&1 | tee -a rom-audit-run.log
```

Resume after a reboot or Ctrl-C: the same command. A finished pilot or a valid hardening certificate is
detected and skipped (`scripts/rom-audit/stage-status.ts`); the `full` stage resumes from its checkpoint.
Run one stage: `ROM_AUDIT_STAGE_ONLY=full bash scripts/rom-audit/run-full.sh`.
`ROM_AUDIT_WORKERS=N` sets the worker count (default: logical CPUs minus one).
`ROM_AUDIT_RETRY_FAILURES=1` re-runs jobs recorded as failed. Only the SIDLite renderer is supported;
reSIDfp lanes are refused (see the design document).

## Prerequisites (Linux x86-64)

`bun` 1.3.x, `node`, `npm` (the repository test suite builds with npm) and `git`; about 5 GB free disk
and 650 MB RAM per worker (workers are recycled every 200 jobs; the log shows peak worker RSS). No
compiler, Docker or native build is needed: the census runs the prebuilt WASM engine from the npm
package. The script stops with a message if a tool is missing.

## Stages

| Stage | What it does | Stops when |
|---|---|---|
| `setup` | `bun install --frozen-lockfile`, fetches HVSC (the latest release; HVSC 85 is required), fetches the authentic ROMs, verifies the corpus identity `4b66fe03e72e18155ee4e14a0a7fd3f2c4de2ed1a467296156d5642e716f132e` (61,157 files / 87,868 subtunes), checks that `doc/research/hvsc-rom-adversarial-review.md` carries an `Approved-source-identity` line (the last one counts) for the sources you checked out (`bun scripts/rom-audit/harden.ts --identity`), and runs the repository test suite once so that environment problems show up before the pilot. | A different HVSC release (once HVSC 86 exists, place the HVSC 85 collection in `workspace/hvsc/C64Music` first), a modified file, sources without architect approval, or a failing test. |
| `pilot` | Renders the reviewed stratified pilot (567 subtunes, under the 5% ceiling). About an hour on 7 workers. | A job error is recorded as a failure, not a stop. |
| `harden` | Decision-path regression on the census engines, pilot completeness (engine hashes, tool hash, no failed jobs), publication, fresh-process re-run equality, three focused test runs and three complete repository suites (each 0 fail, 0 skip). Writes `workspace/rom-audit-hardening/certificate.json`. About 1.5 hours. | Any failed check, or any change to the sources or engine during qualification. |
| `full` | `audit.ts --rollout full` with the certificate: every subtune at its full documented horizon, resumable. | Rerun to continue. |
| `publish` | Writes `workspace/rom-audit-full/published/` (`manifest.json`, `deny-list.<engine>.json`, `research.jsonl.gz`, `census.jsonl.gz`) and prints coverage. | |

The certificate is verified again when `full` starts: source identity, and every cited log is
re-hashed and re-parsed (test logs must show 0 fail and 0 skip, the regression digest must match).

## Monitoring

```sh
tail -n 3 rom-audit-run.log                 # done/total, failures, horizon-seconds per second, ETA in hours
cat workspace/rom-audit-full/coverage.json  # after a stage ends
wc -l workspace/rom-audit-full/census.jsonl # one line per finished subtune
```

A job that exceeds its timeout (ten times its expected duration, at least five minutes) or throws
is recorded as a failure and its decisions are `unknown`; the census goes on. Rerun with
`ROM_AUDIT_RETRY_FAILURES=1` after fixing the cause.

## After the run

1. Read `workspace/rom-audit-full/published/manifest.json`: per-mask `compatible` /
   `incompatible` / `unknown` counts with reasons, `measuredSubtunes`, `failedSubtunes` and
   `pendingSubtunes` (0 pending and 0 failed for a complete census), `unsupportedDuration` in
   `coverage.json`.
2. To commit the dataset, copy the published files into `doc/research/hvsc-rom-catalogue/v3/`,
   run `bun test packages/sidflow-common/test/rom-eligibility.test.ts` (it checks every published
   decision against the production lookup) and open a PR.
3. A subtune with a horizon above 3,600 s is never clamped; it stays pending.

## What a result means

`compatible` applies to the consumer profile in the design document (WASM 1.1.0, 48 kHz, default
power-on delay, ROM sets {KERNAL+BASIC with CHARGEN null, nothing}) and the documented duration plus
5 s, nothing more. **It applies to the renderer the census ran: SIDLite.** Commander's default renderer
depends on the build (SidplayEZ on Android, reSIDfp on web and iOS); neither is covered. Unknown is not failure: the set "nothing
supplied" is `unknown` for almost every program, because the engine's interrupt shim shifts SID
writes by a few cycles. The decision also assumes the MOS8580 fallback SID model unless the header names the model of every chip.
