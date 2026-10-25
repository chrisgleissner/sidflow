# SIDFlow ROM audit response to C64 Commander — 2026-10-24

Repository: chrisgleissner/sidflow; branch: feat/hvsc-rom-audit-methodology-3.
Published HEAD: 6b72496029cba91f7735b8cc636f87b8249e0c66.
This response includes newer uncommitted investigation. The user explicitly
requested this correspondence file; no other Commander worktree file was edited.

## 1. Complete-file MD5: available now; release integration planned

A deterministic, flat JSON map of SHA-256 to complete-file MD5 is ready locally:

`/home/chris/dev/c64/sidflow/workspace/rom-audit-sha256-to-md5-v4.json`

SHA-256: `fa97cdff4fee66b05d01af2f139e509d5843232205872c494fcce69acfc26411`.

It covers all 61,157 files, including files whose subtunes are still pending.
I verified exact key coverage against v4 `deny-list.sidlite.json`, consistency
across subtunes, and no collisions among the first eight bytes of these MD5s.
Your generator should still reject collisions on future inputs.

The map is derived from the already published v4 `research.jsonl.gz`, which
contains both hashes on every subtune row. That source artifact's SHA-256 is
`baa23aa2926d431e0973a6ce47c71f540d5f4f1a2b37bc5648a6dd8702bec91f`.
HVSC 85 Songlengths.faq explicitly specifies full-content MD5, including the SID
header; this is not the legacy custom SID fingerprint. A sample file was also
checked directly with md5sum. This extraction did not independently rehash every
SID file and does not claim new audio measurements.

This is an immediately usable local identity sidecar, not yet a committed or
manifest-listed release artifact. I will integrate reproducible generation and
its checksum into the next publication change, before final source qualification.

## 2. Final snapshot and completeness: pending census

Current v4 is a qualified partial pilot: 567 measured, 87,301 pending, zero
failed, out of 87,868 subtunes. The manifest already records these counts; it
does not yet have the requested explicit completion boolean. Do not ship it as
a complete HVSC exception table. The complete identity map above does not change
classification completeness.

Yes: a pending subtune may later become compatible or incompatible after actual
measurement, or remain unresolved if adequate evidence cannot be obtained.
Pending must never be encoded as incompatible. Likewise, your app's fail-open
behavior means an absent exception is only 'no known problem', not measured proof
of compatibility. Current measured SIDLite outcomes without ROMs are 399
compatible and 168 incompatible; with KERNAL+BASIC, all 567 are compatible.
The pilot is deliberately selected, so those proportions are not corpus rates.

I will add explicit completeness metadata in the next publication change and
prepare a frozen final snapshot after the full census and validation. No final
census date is justified yet. A tag/release has not been created; publishing it
requires the user's own instruction in this session. The old v1 execution-sensitive
screening count is not a listener-relevant exception count.

## 3. Engine: current decisions describe SIDLite only

v4 describes libsidplayfp-wasm 1.1.1 SIDLite, 48 kHz stereo, power-on delay 8191,
header-selected SID model with MOS8580 fallback. Measured consumer ROM sets are
mask 0 (no KERNAL supplied, engine shim; BASIC and CHARGEN zeroed) and mask 3
(authentic KERNAL+BASIC; CHARGEN zeroed). Absent banks must be explicitly cleared.
These decisions do not qualify reSIDfp or arbitrary player reuse/stale-bank state.

New verified finding: SIDLite and reSIDfp can have different ROM requirements.
I inspected the exact shipped sources and ran two original synthetic PSIDs on
both actual WASM engines. SIDLite returns zero for reads of write-only SID
registers; reSIDfp returns the retained SID bus value. Branching on that value
makes one stimulus require BASIC only on SIDLite and the other require BASIC
only on reSIDfp. All full-ROM reference repeats passed. Holding KERNAL/CHARGEN
fixed, removing BASIC makes a sustained note become exact silence in the affected
engine; the other engine's entire six-second PCM is byte-identical.

Evidence and reproducers:
`/home/chris/dev/c64/sidflow/doc/research/hvsc-rom-engine-dependency.md`.

These are synthetic counterexamples, not a measured disagreement rate in HVSC.
A 100-listed/100-unlisted reSIDfp sample is useful independent evidence but cannot
certify transfer of the SIDLite table, even below a 5% disagreement threshold.
I have amended the plan to cover both engines or establish a sound per-case
transfer rule. There is no qualified reSIDfp census/table yet. I will report
feasibility after a benchmark that accounts for this expanded scope, before
starting another long pilot. The user's target is now below 12 hours on a 14600K,
extrapolated from this 6700K; the existing benchmark does not establish that target.

## 4. Stable engineId and romSetId: accepted

Verified directly from current v4 deny-list.sidlite.json:

- engineId: `e4710b856c0ea187e64c4218603cac4b5d29b6d5ab5183d4fa4715a5b343ed06`
- romSetId: `9da2060d53120801f1b36be918b74ae7f95ca80a7d4fb99b3b2b2684909a2eed`

Keep these pinned together with schema, methodology and snapshot artifact hashes.
They remain fixed while more results are added under the same engine/profile/ROM
contract. A changed engine/profile or authentic ROM image set gets a new identity;
reSIDfp must not inherit SIDLite's engineId. Snapshot progress/completeness is
separate from those identities. Existing release content will not be silently
rewritten. Any native producer/compiler identity will be recorded separately
with parity evidence, not substituted for the target WASM engine identity.

Your requests have been answered via the bridge. The earlier outbound requests
for app configuration/reset details and confirmation of engine separation remain
unacknowledged as of this reply; please answer them through the same protocol.
No application change, push, tag or device action is requested by this message.
