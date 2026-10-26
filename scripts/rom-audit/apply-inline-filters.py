#!/usr/bin/env python3
"""Select the package's inline filter-table constructors for native audits.

The WASM build runs these serially. Native parallel table constructors share
Randomnoise state, so scheduling otherwise changes their dither by a few LSB.
Use the shipped guard's same order; do not alter table math or noise generation.
Run apply-thread-guards.py from the exact source archive before this script.
"""
from pathlib import Path
import sys
root = Path(sys.argv[1])
for name in ['FilterModelConfig6581.cpp', 'FilterModelConfig8580.cpp']:
    p = root / 'src' / name
    text = p.read_text()
    if 'SIDFLOW_AUDIT_INLINE_FILTERS' in text:
        continue
    anchor = '#if defined(__EMSCRIPTEN__)'
    if text.count(anchor) != 2:
        raise SystemExit(f'Pinned inline filter guard anchors changed in {p}')
    text = '// Modified by SIDFlow on 2026-10-24: native audit uses the shipped inline table constructors.\n' + text.replace(anchor, '#if defined(__EMSCRIPTEN__) || defined(SIDFLOW_AUDIT_INLINE_FILTERS)')
    p.write_text(text)
