// A native renderer configured *exactly* like the WASM bindings.
//
// The distro's /usr/bin/sidplayfp is libsidplayfp 2.6.0, while the WASM build is
// v3.0.2 + libresidfp 1.1.2. Comparing across that gap conflates "our build is
// wrong" with "upstream changed". This binary is the matched control: same
// library versions, same SidConfig, same render loop as bindings.cpp — so any
// residual difference against the WASM is attributable to the WASM build alone.
//
// Usage: native_render <tune.sid> <seconds> <out.raw> [songIndex] [romDir]
// Writes interleaved stereo s16le at 48 kHz.

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <vector>

#include <sidplayfp/sidplayfp.h>
#include <sidplayfp/SidConfig.h>
#include <sidplayfp/SidInfo.h>
#include <sidplayfp/SidTune.h>
#include <sidplayfp/SidTuneInfo.h>
#include <sidplayfp/builders/residfp.h>

namespace {

constexpr uint32_t kSampleRate = 48000;
constexpr bool kStereo = true;
// Overridable so the same chunk-size sweep can be run natively as in the wasm
// harness; a correct engine should be chunk-size invariant.
inline unsigned int chunkCycles() {
    const char *env = std::getenv("SIDFLOW_CHUNK_CYCLES");
    return env != nullptr ? static_cast<unsigned int>(std::atoi(env)) : 100000U;
}

std::vector<uint8_t> readFile(const char *path) {
    std::ifstream in(path, std::ios::binary);
    return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

}  // namespace

int main(int argc, char **argv) {
    if (argc < 4) {
        std::fprintf(stderr, "usage: native_render <tune.sid> <seconds> <out.raw> [songIndex] [romDir]\n");
        return 2;
    }

    const char *tunePath = argv[1];
    const double seconds = std::atof(argv[2]);
    const char *outPath = argv[3];
    const unsigned int songIndex = argc > 4 ? static_cast<unsigned int>(std::atoi(argv[4])) : 0;
    const char *romDir = argc > 5 ? argv[5] : nullptr;

    sidplayfp player;
    // Constructed and handed to config() exactly as bindings.cpp does; the
    // player locks/creates the emulation itself.
    auto builder = std::make_unique<ReSIDfpBuilder>("NativeReSIDfp");

    if (romDir != nullptr) {
        static std::vector<uint8_t> kernal, basic, chargen;
        kernal = readFile((std::string(romDir) + "/kernal.bin").c_str());
        basic = readFile((std::string(romDir) + "/basic.bin").c_str());
        chargen = readFile((std::string(romDir) + "/chargen.bin").c_str());
        player.setRoms(kernal.size() == 8192 ? kernal.data() : nullptr,
                       basic.size() == 8192 ? basic.data() : nullptr,
                       chargen.size() == 4096 ? chargen.data() : nullptr);
    }

    SidConfig cfg;
    cfg.frequency = kSampleRate;
    cfg.sidEmulation = builder.get();
    cfg.samplingMethod = SidConfig::RESAMPLE_INTERPOLATE;
    cfg.digiBoost = true;
    cfg.powerOnDelay = SidConfig::MAX_POWER_ON_DELAY;

    const std::vector<uint8_t> tuneBytes = readFile(tunePath);
    SidTune tune(tuneBytes.data(), static_cast<uint32_t>(tuneBytes.size()));
    if (!tune.getStatus()) {
        std::fprintf(stderr, "tune: %s\n", tune.statusString());
        return 1;
    }

    if (!player.config(cfg)) {
        std::fprintf(stderr, "config: %s\n", player.error());
        return 1;
    }
    if (player.installedSIDs() > 0U) player.initMixer(kStereo);

    tune.selectSong(songIndex);
    if (!player.load(&tune)) {
        std::fprintf(stderr, "load: %s\n", player.error());
        return 1;
    }
    if (!player.reset()) {
        std::fprintf(stderr, "reset: %s\n", player.error());
        return 1;
    }
    if (player.installedSIDs() > 0U) player.initMixer(kStereo);

    const SidInfo &info = player.info();
    std::fprintf(stderr, "engine=%s %s kernal=%s\n", info.name(), info.version(), info.kernalDesc());

    const unsigned int channels = kStereo ? 2U : 1U;
    const size_t wanted = static_cast<size_t>(seconds * kSampleRate) * channels;
    std::vector<int16_t> out;
    out.reserve(wanted);
    std::vector<int16_t> mixBuffer;

    int empties = 0;
    while (out.size() < wanted) {
        const int produced = player.play(chunkCycles());
        if (produced < 0) {
            std::fprintf(stderr, "play: %s\n", player.error());
            return 1;
        }
        if (produced == 0) {
            if (++empties > 64) break;
            continue;
        }
        empties = 0;
        const size_t need = static_cast<size_t>(produced) * channels;
        if (mixBuffer.size() < need) mixBuffer.resize(need);
        const unsigned int written = player.mix(mixBuffer.data(), static_cast<unsigned int>(produced));
        const size_t take = std::min(static_cast<size_t>(written), wanted - out.size());
        out.insert(out.end(), mixBuffer.begin(), mixBuffer.begin() + take);
    }

    std::ofstream fout(outPath, std::ios::binary);
    fout.write(reinterpret_cast<const char *>(out.data()), static_cast<std::streamsize>(out.size() * sizeof(int16_t)));
    std::fprintf(stderr, "wrote %zu frames\n", out.size() / channels);
    return 0;
}
