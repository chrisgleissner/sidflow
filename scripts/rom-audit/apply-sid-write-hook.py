#!/usr/bin/env python3
"""Inject a SID register write-trace hook into libsidplayfp's own sidemu.

Why this exists
---------------
Hosts need to observe SID register writes; SIDFlow, for instance, extracts
native features from them. Tracing must not be able to alter the audio, so it is
a nullable function pointer consulted at the single funnel every CPU SID write
already passes through. The audio path stays upstream's own emulation object,
byte for byte, and with the hook unset — the default — the emulation is exactly
upstream's.

Why not subclass sidemu
-----------------------
Wrapping a real emulation in a `libsidplayfp::sidemu` subclass and mirroring its
state does not work, and fails audibly rather than loudly:

    m_buffer = inner->buffer();
    bufferpos(inner->bufferpos());

`sidemu::bufferpos()` is **not virtual** (src/sidemu.h), and src/player.cpp
drives the consume cycle through it — `sampleCount = s->bufferpos();` then
`s->bufferpos(0);`. Those calls land on the *outer* wrapper, while samples are
produced into the *inner* emulation's buffer
(`m_bufferpos += m_sid.clock(cycles, m_buffer + m_bufferpos)`). Inner's
m_bufferpos is then never reset: it grows without bound, the write cursor walks
off the end of inner's buffer, and every sync hands the mixer an ever-growing
stale sample count.

Why sidemu::writeReg
--------------------
`c64sid::write()` masks the address and calls `writeReg()`, which `sidemu`
implements `override final`. Every CPU write to a SID register funnels through
it, for every builder (reSIDfp, SIDLite, exSID...), and it has `eventScheduler`
in scope for the PHI1 timestamp. Hooking here means one patch site instead of
one per builder.

The hook is invoked immediately before `write(addr, data)`, so it observes the
same post-mute/post-filter-mask value the emulation itself receives.

This patch is applied to a pinned upstream checkout. It fails loudly if an
anchor is missing rather than silently producing an artifact with no tracing.
"""

from __future__ import annotations

import sys
from pathlib import Path

HOOK_SYMBOL = "sidflow_sid_write_hook"

INCLUDE_ANCHOR = '#include "sidemu.h"\n'

# GPL-2.0 section 2(a) requires a modified file to say that it was changed and
# when. This notice is inserted into the upstream source inside the build
# container; see MODIFICATIONS.md in the libsidplayfp-wasm repository.
HOOK_DECLARATION = '''
// --- MODIFIED by the libsidplayfp-wasm project on 2026-07-28 --------------
// This file is not upstream libsidplayfp as released. A SID register
// write-trace hook has been added below and invoked from sidemu::writeReg.
// See https://github.com/chrisgleissner/libsidplayfp-wasm (MODIFICATIONS.md).
//
// The pointer is defined in bindings.cpp and is null unless tracing has been
// explicitly enabled, in which case it receives every CPU write to a SID
// register. It observes only — it can never influence emulation output.
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
