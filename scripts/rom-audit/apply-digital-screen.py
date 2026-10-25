#!/usr/bin/env python3
"""Add opt-in digital and bus-only screens; leave audio clocking unchanged.

Bus-only runs preserve the actual reSIDfp bus value/TTL and SIDLite zero reads.
An OSC3/ENV3 read aborts that run BEFORE it could grant a decision. Its immutable
input is then rerun with upstream clockSilent()/normal SIDLite clocking. Thus no
oscillator/envelope value is fabricated or transferred between engines.
"""
from pathlib import Path
import sys
root = Path(sys.argv[1])
resid = root.parent / 'libresidfp'
for relative, old, new in [
    ('src/SID.h', '    void clockSilent(unsigned int cycles);', '    void clockSilent(unsigned int cycles);\n    // Modified by SIDFlow on 2026-10-24: bus-only screen; stateful reads abort.\n    void clockBusOnly(unsigned int cycles) { ageBusValue(cycles); }'),
    ('src/residfp/residfp.h', '    void clockSilent(unsigned int cycles);', '    void clockSilent(unsigned int cycles);\n    // Modified by SIDFlow on 2026-10-24: native audit bus-only screen.\n    void clockBusOnly(unsigned int cycles);'),
    ('src/residfp/residfp.cpp', 'void residfp::clockSilent(unsigned int cycles)\n{\n    sid.clockSilent(cycles);\n}', 'void residfp::clockSilent(unsigned int cycles)\n{\n    sid.clockSilent(cycles);\n}\n\n// Modified by SIDFlow on 2026-10-24: native audit bus-only screen.\nvoid residfp::clockBusOnly(unsigned int cycles)\n{\n    sid.clockBusOnly(cycles);\n}')
]:
    p = resid / relative
    text = p.read_text()
    if 'clockBusOnly' in text:
        continue
    if text.count(old) != 1:
        raise SystemExit(f'Pinned bus clock anchor changed in {p}')
    p.write_text(text.replace(old, new, 1))
for builder, implementation in [('sidlite', 'SIDLiteEmu'), ('residfp', 'reSIDfpEmu')]:
    p = root / f'src/builders/{builder}-builder/{builder}-emu.cpp'
    text = p.read_text()
    if 'sidflow_bus_only' in text:
        continue
    namespace = 'namespace libsidplayfp\n{'
    if text.count(namespace) != 1:
        raise SystemExit(f'Pinned namespace changed in {p}')
    text = text.replace(namespace, '#include <stdexcept>\nextern "C" bool sidflow_digital_only, sidflow_bus_only, sidflow_warmup;\n\n'+namespace, 1)
    read = f'uint8_t {implementation}::read(uint_least8_t addr)\n{{'
    if text.count(read) != 1:
        raise SystemExit(f'Pinned SID read anchor changed in {p}')
    text = text.replace(read, read + '\n    // Modified by SIDFlow on 2026-10-24: never invent a stateful SID read.\n    if (::sidflow_bus_only && (addr == 0x1b || addr == 0x1c))\n        throw std::runtime_error("stateful SID read requires detailed screen");', 1)
    if builder == 'residfp':
        old = '    m_bufferpos += m_sid.clock(cycles, m_buffer+m_bufferpos);'
        new = '''    // Modified by SIDFlow on 2026-10-24: opt-in screens only.
    if (::sidflow_bus_only) m_sid.clockBusOnly(cycles);
    else if (::sidflow_digital_only) m_sid.clockSilent(cycles);
    else m_bufferpos += m_sid.clock(cycles, m_buffer+m_bufferpos);
    if (::sidflow_warmup && m_accessClk >= 1024000) ::sidflow_bus_only = true;'''
    else:
        old = '    m_accessClk += cycles;'
        new = old + '\n    // Modified by SIDFlow on 2026-10-24: other SIDLite reads are constant zero.\n    if (::sidflow_bus_only) return;'
    if text.count(old) != 1:
        raise SystemExit(f'Pinned SID clock anchor changed in {p}')
    text = text.replace(old,new,1)
    if builder == 'sidlite':
        anchor = '    m_bufferpos += m_sid.clock(cycles, m_buffer+m_bufferpos);'
        if text.count(anchor) != 1:
            raise SystemExit(f'Pinned SIDLite output clock changed in {p}')
        text = text.replace(anchor, anchor + '\n    if (::sidflow_warmup && m_accessClk >= 1024000) ::sidflow_bus_only = true;', 1)
    p.write_text(text)
