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

# Extended 2026-10-23: count mapped CPU reads for every system bank. The MMU
# dispatches here only when that ROM is actually banked in; RAM-under-ROM reads
# do not count. Includes instruction fetches but does not distinguish them.
text = source.read_text()
for bank, size, symbol in [('KernalRomBank', '0x2000', 'kernal'),
                           ('CharacterRomBank', '0x1000', 'chargen')]:
    marker = f'sidflow_{symbol}_reads'
    if marker in text:
        continue
    text = text.replace(anchor, f'// Modified by SIDFlow on 2026-10-23: passive {symbol} read counter.\nextern "C" unsigned long long {marker};\n\n' + anchor, 1)
    method = f'''public:
    uint8_t peek(uint_least16_t address) override
    {{
        ++::{marker};
        return romBank<{size}>::peek(address);
    }}
'''
    old = f'class {bank} final : public romBank<{size}>\n{{'
    if bank == 'CharacterRomBank':
        old = f'class {bank} final : public romBank<{size}> {{}};'
        new = f'class {bank} final : public romBank<{size}>\n{{\n{method}}};'
    else:
        new = old + '\n' + method
    if text.count(old) != 1:
        raise SystemExit(f'Pinned {bank} anchor changed in {source}')
    text = text.replace(old, new, 1)
source.write_text(text)

# Extended 2026-10-23: count EVERY CPU read of a SID register (any chip, any mirror).
# A read returns engine-specific state (OSC3/ENV3 are sampled at engine-specific moments, write-only
# registers return a decaying bus value in reSIDfp), so a program that never reads a SID follows the
# same CPU path under every SID builder and every output sample rate.
for builder, implementation in [('sidlite', 'SIDLiteEmu'), ('residfp', 'reSIDfpEmu')]:
    emulator = source.parents[2] / f'builders/{builder}-builder/{builder}-emu.cpp'
    text = emulator.read_text()
    if 'sidflow_sid_readback_reads' in text:
        continue
    old = f'uint8_t {implementation}::read(uint_least8_t addr)\n' + '{\n    clock();'
    new = old.replace('    clock();', '''
    // Modified by SIDFlow on 2026-10-23: passive counter of SID register reads.
    ++::sidflow_sid_readback_reads;
    clock();'''.lstrip('\n'))
    namespace_anchor = 'namespace libsidplayfp\n{'
    if text.count(old) != 1 or text.count(namespace_anchor) != 1:
        raise SystemExit(f'Pinned {builder} read anchor changed in {emulator}')
    text = text.replace(namespace_anchor, 'extern "C" unsigned long long sidflow_sid_readback_reads;\n\n' + namespace_anchor, 1)
    emulator.write_text(text.replace(old, new, 1))
