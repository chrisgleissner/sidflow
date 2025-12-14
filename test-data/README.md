# Test Data - HVSC Sample SID Files

This directory contains a small sample of SID files from the High Voltage SID Collection (HVSC) for testing purposes.

## Directory Structure

The folder hierarchy mirrors the original HVSC structure:

```
test-data/
└── C64Music/
    └── MUSICIANS/
        ├── G/
        │   ├── Garvalf/
        │   │   └── Lully_Marche_Ceremonie_Turcs_Wip.sid
        │   └── Greenlee_Michael/
        │       └── Foreign_Carols.sid
        └── S/
            └── Szepatowski_Brian/
                └── Superman_Pt02_Theme.sid
```

## Source

These SID files are from **HVSC Update #83**, downloaded from:
[hvsc.brona.dk/HVSC/HVSC_Update_83.7z](https://hvsc.brona.dk/HVSC/HVSC_Update_83.7z)

## Current Test Files

These SID files were selected to avoid requiring external C64 ROM files in SIDFlow’s default test playback configuration:

1. **Lully_Marche_Ceremonie_Turcs_Wip.sid**
   - Artist: Eric F. (Garvalf)
   - Copyright: 2016 Garvalf
   - Size: ~1.1 KB

2. **Superman_Pt02_Theme.sid**
   - Artist: Brian M. Szepatowski
   - Copyright: 1985 Brian M. Szepatowski
   - Size: ~8.4 KB

3. **Foreign_Carols.sid**
   - Artist: Michael Greenlee
   - Copyright: 198? Michael Greenlee
   - Size: ~8.8 KB

These files were selected by:
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
