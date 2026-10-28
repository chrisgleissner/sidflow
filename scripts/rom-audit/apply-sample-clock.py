#!/usr/bin/env python3
"""Experimental sample-aligned digital screen, reSIDfp only.

Keep CPU/SID readback execution and exact upstream resampler readiness, omitting
analogue filtering/convolution. Output is FRAME COUNTS + WRITES, never PCM.
This hook is used only in a separate experimental build tree.
"""
from pathlib import Path
import sys
root = Path(sys.argv[1])
resid = root.parent / 'libresidfp'
def replace(file, old, new):
    text = file.read_text()
    if text.count(old) != 1:
        raise SystemExit(f'Pinned sample-clock anchor changed: {file}: {old[:60]}')
    file.write_text(text.replace(old,new,1))
replace(resid/'src/resample/Resampler.h','    virtual void reset() = 0;', '''    // SIDFlow experimental: counts only, no audio samples or convolution.
    virtual unsigned int advanceClock(unsigned int) { throw "unsupported sample clock"; }
    virtual void reset() = 0;''')
replace(resid/'src/resample/SincResampler.h','    void reset() override;', '''    unsigned int advanceClock(unsigned int cycles) override
    {
        // Equivalent to input() readiness for downsampling. Audio is not read.
        if (cyclesPerSample < 1024) throw "unsupported upsampling clock";
        const long long needed = static_cast<long long>(cycles) * 1024 - sampleOffset;
        const unsigned int count = needed > 0 ? (needed + cyclesPerSample - 1) / cyclesPerSample : 0;
        sampleOffset += static_cast<long long>(count) * cyclesPerSample - static_cast<long long>(cycles) * 1024;
        return count;
    }
    void reset() override;''')
replace(resid/'src/resample/TwoPassSincResampler.h','    void reset() override', '''    unsigned int advanceClock(unsigned int cycles) override
    {
        return s2->advanceClock(s1->advanceClock(cycles));
    }
    void reset() override''')
replace(resid/'src/SID.h','    void clockSilent(unsigned int cycles);', '''    void clockSilent(unsigned int cycles);
    unsigned int clockSampleCount(unsigned int cycles, short* buffer);''')
replace(resid/'src/SID.cpp','void SID::clockSilent(unsigned int cycles)', '''unsigned int SID::clockSampleCount(unsigned int cycles, short* buffer)
{
    const auto count = resampler->advanceClock(cycles);
    std::fill(buffer, buffer + count, 0); // internal mixer readiness only; never exported as audio
    return count;
}

void SID::clockSilent(unsigned int cycles)''')
replace(resid/'src/residfp/residfp.h','    void clockSilent(unsigned int cycles);','''    void clockSilent(unsigned int cycles);
    unsigned int clockSampleCount(unsigned int cycles, short* buffer);''')
replace(resid/'src/residfp/residfp.cpp','void residfp::clockSilent(unsigned int cycles)', '''unsigned int residfp::clockSampleCount(unsigned int cycles, short* buffer)
{
    return sid.clockSampleCount(cycles, buffer);
}
void residfp::clockSilent(unsigned int cycles)''')
file=root/'src/builders/residfp-builder/residfp-emu.cpp'
replace(file,'extern "C" bool sidflow_digital_only, sidflow_bus_only, sidflow_warmup;', 'extern "C" bool sidflow_digital_only, sidflow_bus_only, sidflow_warmup, sidflow_sample_clock;')
replace(file,'    if (::sidflow_bus_only) m_sid.clockBusOnly(cycles);', '''    if (::sidflow_sample_clock) {
        if (::sidflow_bus_only) m_sid.clockBusOnly(cycles);
        else m_sid.clockSilent(cycles);
        m_bufferpos += m_sid.clockSampleCount(cycles, m_buffer+m_bufferpos);
    }
    else if (::sidflow_bus_only) m_sid.clockBusOnly(cycles);''')
