# Test Data - HVSC Sample SID Files

This directory contains a small sample of SID files from the High Voltage SID Collection (HVSC) for testing purposes.

## Directory Structure

The folder hierarchy mirrors the original HVSC structure:

```
test-data/
└── C64Music/
    ├── DEMOS/
    │   └── 0-9/
    │       └── 10_Orbyte.sid
    └── MUSICIANS/
        ├── C/
        │   ├── C0zmo/
        │   │   └── Space_Oddity_2SID.sid          ← 2-SID chip (PSID v3)
        │   └── Chiummo_Gaetano/
        │       └── Waterfall_3SID.sid             ← 3-SID chip (PSID v4)
        ├── G/
        │   ├── Garvalf/
        │   │   └── Lully_Marche_Ceremonie_Turcs_Wip.sid
        │   └── Greenlee_Michael/
        │       └── Foreign_Carols.sid
        ├── H/
        │   └── Huelsbeck_Chris/
        │       └── Great_Giana_Sisters.sid
        ├── N/
        │   └── Ninja/
        │       └── Ta-Boo.sid
        └── S/
            └── Szepatowski_Brian/
                └── Superman_Pt02_Theme.sid
```

## Source

These SID files are from **HVSC Update #83**, downloaded from:
[hvsc.brona.dk/HVSC/HVSC_Update_83.7z](https://hvsc.brona.dk/HVSC/HVSC_Update_83.7z)

## Current Test Files

These SID files were selected to avoid requiring external C64 ROM files in SIDFlow's default test playback configuration:

1. **10_Orbyte.sid** (DEMOS/0-9/)
   - Included for DEMOS category coverage

2. **Space_Oddity_2SID.sid** (MUSICIANS/C/C0zmo/)
   - Artist: C0zmo
   - PSID v3 — uses **2 SID chips** (secondSIDAddress set)
   - Regression SID for multi-chip classification pipeline testing

3. **Waterfall_3SID.sid** (MUSICIANS/C/Chiummo_Gaetano/)
   - Artist: Gaetano Chiummo
   - PSID v4 — uses **3 SID chips** (secondSIDAddress + thirdSIDAddress set)
   - Regression SID for multi-chip classification pipeline testing

4. **Lully_Marche_Ceremonie_Turcs_Wip.sid** (MUSICIANS/G/Garvalf/)
   - Artist: Eric F. (Garvalf)
   - Copyright: 2016 Garvalf
   - Size: ~1.1 KB

5. **Foreign_Carols.sid** (MUSICIANS/G/Greenlee_Michael/)
   - Artist: Michael Greenlee
   - Copyright: 198? Michael Greenlee
   - Size: ~8.8 KB

6. **Great_Giana_Sisters.sid** (MUSICIANS/H/Huelsbeck_Chris/)
   - Artist: Chris Huelsbeck
   - Multi-song SID (classic C64 title)

7. **Ta-Boo.sid** (MUSICIANS/N/Ninja/)
   - Artist: Ninja

8. **Superman_Pt02_Theme.sid** (MUSICIANS/S/Szepatowski_Brian/)
   - Artist: Brian M. Szepatowski
   - Copyright: 1985 Brian M. Szepatowski
   - Size: ~8.4 KB

The original three files (Lully, Foreign_Carols, Superman) were selected by:
1. Extracting HVSC_Update_83.7z
2. Scanning for newly added SID files
3. Checking PSID headers to verify no BASIC/Kernal ROM requirements (flag bit analysis)
4. Selecting three diverse files from different artists

## Purpose

These SID files are used for:
- End-to-end integration testing
- CI/CD pipeline validation
- Demonstration of the full SIDFlow workflow
- Coverage testing without requiring ROM files

## License

These SID files are part of the High Voltage SID Collection (HVSC) and are subject to the HVSC license terms.
See: [hvsc.c64.org](https://www.hvsc.c64.org/)
