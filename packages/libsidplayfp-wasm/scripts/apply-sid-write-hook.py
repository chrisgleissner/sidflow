#!/usr/bin/env python3
"""Inject a SID register write-trace hook into libsidplayfp's own sidemu.

Why this exists
---------------
sidflow needs to observe SID register writes (packages/sidflow-classify uses them
for native-feature extraction). The previous implementation did this with a
`TracingSidEmu` class in bindings.cpp: a `libsidplayfp::sidemu` subclass that
wrapped a real emulation and mirrored its state with

    m_buffer = inner->buffer();
    bufferpos(inner->bufferpos());

That was broken, and audibly so. `sidemu::bufferpos()` is **not virtual**
(src/sidemu.h), and src/player.cpp drives the consume cycle through it —
`sampleCount = s->bufferpos();` then `s->bufferpos(0);`. Those calls landed on
the *outer* wrapper, while samples were produced into the *inner* emulation's
buffer (`m_bufferpos += m_sid.clock(cycles, m_buffer + m_bufferpos)`). So
inner's m_bufferpos was never reset: it grew without bound, the write cursor
walked off the end of inner's buffer, and every sync handed the mixer an
ever-growing stale sample count.

The fix is structural: there is no wrapper any more. The audio path is
upstream's own emulation object, byte for byte. Tracing is a nullable function
pointer consulted at the single funnel every CPU SID write already passes
through, so the tracing feature *cannot* alter audio — with the hook unset (the
default, and the only mode the C64 Commander app uses) the emulation is exactly
upstream's.

Why sidemu::writeReg
--------------------
`c64sid::write()` masks the address and calls `writeReg()`, which `sidemu`
implements `override final`. Every CPU write to a SID register funnels through
it, for every builder (reSIDfp, SIDLite, exSID...), and it has `eventScheduler`
in scope for the PHI1 timestamp. Hooking here means one patch site instead of
one per builder.

The hook is invoked immediately before `write(addr, data)`, so it observes the
same post-mute/post-filter-mask value the emulation itself receives — matching
the semantics of the wrapper it replaces.

This patch is applied to a pinned upstream checkout. It fails loudly if an
anchor is missing rather than silently producing an artifact with no tracing.
"""

from __future__ import annotations

import sys
from pathlib import Path

HOOK_SYMBOL = "sidflow_sid_write_hook"

INCLUDE_ANCHOR = '#include "sidemu.h"\n'

HOOK_DECLARATION = '''
// --- sidflow: SID register write trace hook -------------------------------
// Defined in bindings.cpp. Null unless tracing has been explicitly enabled, in
// which case it receives every CPU write to a SID register. It observes only —
// it must never be able to influence emulation output.
extern "C" void (*sidflow_sid_write_hook)(const void *emu, unsigned int addr,
                                          unsigned int data, long long cyclePhi1);
// --------------------------------------------------------------------------
'''

WRITE_ANCHOR = """    }

    write(addr, data);
}
"""

WRITE_REPLACEMENT = """    }

    if (sidflow_sid_write_hook != nullptr)
    {
        sidflow_sid_write_hook(this, addr, data,
            eventScheduler != nullptr
                ? static_cast<long long>(eventScheduler->getTime(EVENT_CLOCK_PHI1))
                : 0LL);
    }

    write(addr, data);
}
"""


def patch_sidemu(build_root: Path) -> None:
    source = build_root / "src" / "sidemu.cpp"
    if not source.is_file():
        raise SystemExit(f"expected {source} to exist; upstream layout changed")

    text = source.read_text(encoding="utf-8")

    if HOOK_SYMBOL in text:
        print(f"sid-write-hook: {source} already patched")
        return

    if INCLUDE_ANCHOR not in text:
        raise SystemExit(f'{source}: could not find include anchor {INCLUDE_ANCHOR!r}')
    if WRITE_ANCHOR not in text:
        raise SystemExit(
            f"{source}: could not find the writeReg() -> write() anchor. Upstream "
            "changed sidemu::writeReg; re-derive this patch before shipping, or "
            "SID write tracing will silently stop working."
        )
    if text.count(WRITE_ANCHOR) != 1:
        raise SystemExit(f"{source}: writeReg() anchor is ambiguous ({text.count(WRITE_ANCHOR)} matches)")

    text = text.replace(INCLUDE_ANCHOR, INCLUDE_ANCHOR + HOOK_DECLARATION, 1)
    text = text.replace(WRITE_ANCHOR, WRITE_REPLACEMENT, 1)

    source.write_text(text, encoding="utf-8")
    print(f"sid-write-hook: patched {source}")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} <libsidplayfp-build-root>", file=sys.stderr)
        return 2
    patch_sidemu(Path(argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
