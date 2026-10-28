/** Independently compare batched readiness with real upstream SINC input().
 * Audio amplitudes vary; only readiness is compared. No fabricated PCM.
 */
#include "resample/TwoPassSincResampler.h"
#include <iostream>
#include <memory>
#include <stdexcept>
int main() {
    try {
        unsigned checks = 0;
        for (const double clock : {985248.0, 985248.611111, 1022727.142857, 1022730.0}) {
            for (const double rate : {16000.0, 44100.0, 48000.0, 96000.0}) {
                std::unique_ptr<reSIDfp::Resampler> actual(reSIDfp::TwoPassSincResampler::create(clock,rate));
                std::unique_ptr<reSIDfp::Resampler> counted(reSIDfp::TwoPassSincResampler::create(clock,rate));
                for (unsigned batch=0; batch<200; ++batch) {
                    if (batch%37 == 0) { actual->reset(); counted->reset(); }
                    const unsigned cycles = (batch*137+13)%10001;
                    unsigned expected = 0;
                    for (unsigned i=0; i<cycles; ++i) expected += actual->input(static_cast<int>((i*17+batch*31)%60001)-30000);
                    if (counted->advanceClock(cycles) != expected) throw std::runtime_error("Resampler readiness mismatch");
                    ++checks;
                }
            }
        }
        std::cout << checks << " exact sample-clock readiness checks passed (PAL/NTSC, four rates, varying amplitudes, resets and chunk sizes).\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
