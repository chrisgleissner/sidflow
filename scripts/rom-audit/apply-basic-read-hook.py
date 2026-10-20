#!/usr/bin/env python3
"""Observe CPU reads of mapped BASIC ROM, without changing returned bytes.

Zero reads proves that swapping this bank cannot change that deterministic
execution window. Writes under ROM still go to RAM through libsidplayfp's MMU.
The anchored, idempotent patch fails if the pinned source layout changes.
"""
import sys
from pathlib import Path

source = Path(sys.argv[1]) / "src/c64/Banks/SystemROMBanks.h"
text = source.read_text()
declaration = '''
// Modified by SIDFlow on 2026-10-20: passive mapped BASIC read counter.
extern "C" unsigned long long sidflow_basic_reads;
'''
anchor = 'namespace libsidplayfp\n{'
method_anchor = '''class BasicRomBank final : public romBank<0x2000>
{
private:'''
replacement = '''class BasicRomBank final : public romBank<0x2000>
{
public:
    uint8_t peek(uint_least16_t address) override
    {
        ++::sidflow_basic_reads;
        return romBank<0x2000>::peek(address);
    }
private:'''
if 'sidflow_basic_reads' not in text:
    if text.count(anchor) != 1 or text.count(method_anchor) != 1:
        raise SystemExit(f"Pinned BASIC bank anchors changed in {source}")
    source.write_text(text.replace(anchor, declaration + '\n' + anchor, 1).replace(method_anchor,replacement,1))
