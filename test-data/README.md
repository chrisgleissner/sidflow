# Test Data - HVSC Sample SID Files

This directory contains a small sample of SID files from the High Voltage SID Collection (HVSC) for testing purposes.

## Directory Structure

The folder hierarchy mirrors the original HVSC structure:

```
test-data/
└── C64Music/
    └── MUSICIANS/
        └── [Artist]/
            └── [SID files]
```

## Source

These SID files are from **HVSC Update #83** (released June 28, 2025).

Download the full update from: https://hvsc.brona.dk/HVSC/HVSC_Update_83.7z

## Adding SID Files

To add the 3 required SID files from HVSC_Update_83.7z:

1. Download HVSC_Update_83.7z from https://hvsc.brona.dk/HVSC/HVSC_Update_83.7z
2. Extract the archive
3. Copy 3 SID files from `C64Music/MUSICIANS/` subdirectories
4. Place them in the corresponding `test-data/C64Music/MUSICIANS/` subdirectory
5. Preserve the exact folder hierarchy from the archive

Example:
```bash
# Extract the archive
7z x HVSC_Update_83.7z

# Copy files preserving directory structure
# (Replace these paths with actual files from the archive)
mkdir -p test-data/C64Music/MUSICIANS/Example_Artist
cp C64Music/MUSICIANS/Example_Artist/song1.sid test-data/C64Music/MUSICIANS/Example_Artist/
cp C64Music/MUSICIANS/Example_Artist/song2.sid test-data/C64Music/MUSICIANS/Example_Artist/
cp C64Music/MUSICIANS/Another_Artist/song3.sid test-data/C64Music/MUSICIANS/Another_Artist/
```

## Purpose

These SID files are used for:
- End-to-end integration testing
- CI/CD pipeline validation
- Demonstration of the full SIDFlow workflow

## License

These SID files are part of the High Voltage SID Collection (HVSC) and are subject to the HVSC license terms.
See: https://www.hvsc.c64.org/
