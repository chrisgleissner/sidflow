// Five controlled renders per subtune: both ROMs twice, neither, KERNAL, BASIC.
// Built against the exact libsidplayfp source in the locked WASM package.
// Input: absolute SID path, one-based subtune, seconds (tab separated).
// Output: one JSON object per input, no PCM files. All mixing is in memory.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <sidplayfp/sidplayfp.h>
#include <sidplayfp/SidConfig.h>
#include <sidplayfp/SidInfo.h>
#include <sidplayfp/SidTune.h>
#include <builders/sidlite-builder/sidlite.h>

extern "C" {
void (*sidflow_sid_write_hook)(const void*, unsigned, unsigned, long long) = nullptr;
unsigned long long sidflow_basic_reads = 0;
}

namespace {
constexpr unsigned rate = 8000;
// play() counts scheduler events, not elapsed PHI1 cycles. Large pulls can
// overflow SIDLite 3.0.2's 20ms buffer when VIC DMA stalls the CPU. Small
// batches also bound elapsed time when CPU events are sparse. PCM stays in
// memory, so frequent pulls require no extra filesystem or IPC operations.
constexpr unsigned chunkCycles = 256;
std::vector<uint8_t> read(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("cannot open " + path);
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}
std::string quote(const std::string& value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char c : value) {
        if (c == '\\' || c == '"') out << '\\' << c;
        else if (c < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << unsigned(c) << std::dec;
        else out << c;
    }
    return out.str() + '"';
}
struct Render {
    std::vector<int16_t> pcm;
    struct Write {unsigned chip, address, value; long long cycle;};
    std::vector<Write> writes;
    unsigned long long basicReads = 0;
    std::string derivedFrom;
    std::string error;
};
std::vector<Render::Write>* trace = nullptr;
std::map<const void*,unsigned> chips;
void observe(const void* chip, unsigned address, unsigned value, long long cycle) {
    if (!trace) return;
    if (!chips.count(chip)) chips[chip] = chips.size();
    trace->push_back({chips[chip],address,value,cycle});
}
Render render(const std::vector<uint8_t>& bytes, unsigned song, double seconds,
              const uint8_t* kernal, const uint8_t* basic, const uint8_t* chargen) {
    Render result;
    sidflow_basic_reads = 0;
    try {
        chips.clear(); trace = &result.writes;
        SidTune tune(bytes.data(), static_cast<uint32_t>(bytes.size()));
        if (!tune.getStatus()) throw std::runtime_error(tune.statusString());
        // Declaration order matters: player must release locks before builder dies.
        SIDLiteBuilder builder("ROM audit SIDLite");
        sidplayfp player;
        SidConfig cfg;
        cfg.frequency = rate;
        cfg.sidEmulation = &builder;
        cfg.samplingMethod = SidConfig::RESAMPLE_INTERPOLATE;
        cfg.digiBoost = true;
        cfg.powerOnDelay = 5000; // below MAX: disables randomized power-on delay
        if (!player.config(cfg)) throw std::runtime_error(player.error());
        player.setRoms(kernal, basic, chargen);
        if (tune.selectSong(song) != song) throw std::runtime_error("subtune selection mismatch");
        if (!player.load(&tune)) throw std::runtime_error(player.error());
        if (!player.reset()) throw std::runtime_error("reset failed");
        player.initMixer(true); // retain stereo differences / multi-SID panning
        // Ignore engine reset writes, retain everything the tune does in play().
        result.writes.clear(); chips.clear();
        const size_t wanted = static_cast<size_t>(std::llround(seconds * rate)) * 2;
        result.pcm.reserve(wanted);
        std::vector<int16_t> buffer;
        unsigned empty = 0;
        while (result.pcm.size() < wanted) {
            int produced = player.play(chunkCycles);
            if (produced < 0) throw std::runtime_error(player.error());
            if (produced == 0) {
                if (++empty > 64) throw std::runtime_error("64 consecutive empty renders");
                continue;
            }
            empty = 0;
            buffer.resize(static_cast<size_t>(produced) * 2);
            unsigned written = player.mix(buffer.data(), static_cast<unsigned>(produced));
            if (written == 0) throw std::runtime_error("mixer returned no samples");
            const size_t take = std::min(static_cast<size_t>(written), wanted - result.pcm.size());
            result.pcm.insert(result.pcm.end(), buffer.begin(), buffer.begin() + take);
        }
        player.load(nullptr); // tune is stack allocated after player
    } catch (const std::exception& error) {
        result.error = error.what();
        std::cerr << "render song " << song << ": " << error.what() << '\n';
    }
    trace = nullptr;
    result.basicReads = sidflow_basic_reads;
    return result;
}
double acRms(const std::vector<int16_t>& pcm) {
    if (pcm.empty()) return 0;
    // Centre each stereo channel separately so opposite DC offsets cannot count
    // as audible content. Pooled variance is stable for short quiet windows.
    double sum[2] = {}, squared[2] = {};
    for (size_t i = 0; i < pcm.size(); ++i) { sum[i % 2] += pcm[i]; squared[i % 2] += double(pcm[i]) * pcm[i]; }
    const double n = pcm.size() / 2.0;
    return std::sqrt(std::max(0.0, (squared[0] + squared[1]) / (2*n)
        - (sum[0]*sum[0] + sum[1]*sum[1]) / (2*n*n))) / 32768;
}
std::string hash(const std::vector<int16_t>& pcm) {
    // Diagnostic only; equality is checked sample by sample, never by this hash.
    uint64_t h = 14695981039346656037ULL;
    for (int16_t sample : pcm) {
        h ^= uint8_t(sample); h *= 1099511628211ULL;
        h ^= uint8_t(uint16_t(sample) >> 8); h *= 1099511628211ULL;
    }
    std::ostringstream out; out << std::hex << h; return out.str();
}
void output(const Render& value, const Render& reference) {
    const size_t n = std::min(value.pcm.size(), reference.pcm.size());
    size_t differing = 0; double square = 0; int peak = 0; size_t first = n;
    for (size_t i = 0; i < n; ++i) {
        int delta = int(value.pcm[i]) - reference.pcm[i];
        if (delta) { ++differing; first = std::min(first, i); }
        square += double(delta) * delta; peak = std::max(peak, std::abs(delta));
    }
    std::cout << "{\"error\":" << quote(value.error) << ",\"samples\":" << value.pcm.size()
        << ",\"hash\":" << quote(hash(value.pcm)) << ",\"acRms\":" << acRms(value.pcm)
        << ",\"equal\":" << (value.error.empty() && reference.error.empty() && value.pcm == reference.pcm ? "true" : "false")
        << ",\"differingSamples\":" << differing << ",\"peakDifference\":" << peak
        << ",\"differenceRms\":" << (n ? std::sqrt(square / n) / 32768 : 0)
        << ",\"firstDifferenceSec\":";
    if (differing) std::cout << double(first / 2) / rate; else std::cout << "null";
    const size_t traceCount = std::min(value.writes.size(),reference.writes.size());
    size_t matching = 0;
    while (matching < traceCount) {
        const auto& a = value.writes[matching]; const auto& b = reference.writes[matching];
        if (a.chip != b.chip || a.address != b.address || a.value != b.value) break;
        ++matching;
    }
    // Compare CPU writes independently of SID oscillator phase and fixed start
    // offset. A common prefix is evidence only for that prefix, never the tail.
    long long offset = traceCount ? value.writes[0].cycle-reference.writes[0].cycle : 0;
    long long maxDrift = 0;
    for (size_t i=0; i<matching; ++i) maxDrift = std::max(maxDrift,std::llabs(value.writes[i].cycle-reference.writes[i].cycle-offset));
    std::cout << ",\"sidWrites\":" << value.writes.size() << ",\"matchingWritePrefix\":" << matching
        << ",\"startupOffsetCycles\":" << offset << ",\"maxRelativeWriteDriftCycles\":" << maxDrift
        << ",\"basicReads\":" << value.basicReads << ",\"derivedFrom\":" << quote(value.derivedFrom);
    std::cout << '}';
}
}
int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("usage: render <ROM directory>");
        const std::string dir = argv[1];
        const auto kernal = read(dir + "/kernal.901227-03.bin");
        const auto basic = read(dir + "/basic.901226-01.bin");
        const auto chargen = read(dir + "/characters.901225-01.bin");
        if (kernal.size() != 8192 || basic.size() != 8192 || chargen.size() != 4096)
            throw std::runtime_error("ROM sizes must be 8192 / 8192 / 4096");
        // Without BASIC, explicitly zero the bank. Upstream's null BASIC setter
        // leaves its allocation untouched; reusing it could leak a previous ROM.
        const std::vector<uint8_t> absentBasic(8192, 0);
        std::string line;
        sidflow_sid_write_hook = observe;
        std::cout << std::setprecision(12);
        while (std::getline(std::cin, line)) {
            size_t a = line.find('\t'), b = line.find('\t', a + 1);
            if (a == std::string::npos || b == std::string::npos) throw std::runtime_error("malformed input record");
            const std::string path = line.substr(0, a);
            const unsigned song = std::stoul(line.substr(a + 1, b-a-1));
            const double seconds = std::stod(line.substr(b + 1));
            if (song < 1 || !std::isfinite(seconds) || seconds <= 0 || seconds > 3600)
                throw std::runtime_error("invalid song or duration");
            const auto bytes = read(path);
            auto reference = render(bytes, song, seconds, kernal.data(), basic.data(), chargen.data());
            std::cout << "{\"path\":" << quote(path) << ",\"song\":" << song << ",\"seconds\":" << seconds << ",\"both\":";
            output(reference, reference);
            auto repeat = render(bytes, song, seconds, kernal.data(), basic.data(), chargen.data());
            auto basicOnly = render(bytes, song, seconds, nullptr, basic.data(), chargen.data());
            Render kernalOnly;
            if (reference.basicReads == 0 && reference.error.empty()) {
                kernalOnly = reference; kernalOnly.derivedFrom = "both: zero mapped BASIC reads";
            } else kernalOnly = render(bytes,song,seconds,kernal.data(),absentBasic.data(),chargen.data());
            Render neither;
            if (basicOnly.basicReads == 0 && basicOnly.error.empty()) {
                neither = basicOnly; neither.derivedFrom = "basic: zero mapped BASIC reads";
            } else neither = render(bytes,song,seconds,nullptr,absentBasic.data(),chargen.data());
            std::cout << ",\"repeat\":"; output(repeat,reference);
            std::cout << ",\"neither\":"; output(neither,reference);
            std::cout << ",\"kernal\":"; output(kernalOnly,reference);
            std::cout << ",\"basic\":"; output(basicOnly,reference);
            std::cout << "}\n" << std::flush;
        }
    } catch (const std::exception& error) {
        std::cerr << "ROM audit: " << error.what() << '\n'; return 1;
    }
}
