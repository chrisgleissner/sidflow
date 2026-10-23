// Eight ROM masks (KERNAL=1, BASIC=2, CHARGEN=4) plus repeated full reference.
// Built against the exact libsidplayfp source in the locked WASM package.
// Input: absolute SID path, one-based subtune, seconds (tab separated).
// Output: one JSON object per input, no PCM files. All mixing is in memory.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <map>
#include <sstream>
#include <new>
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
unsigned long long sidflow_basic_reads = 0, sidflow_kernal_reads = 0, sidflow_chargen_reads = 0;
unsigned long long sidflow_sid_readback_reads = 0;
}

namespace {
// Legacy default: 8 kHz and a fixed power-on delay of 5000. The census reads-pass uses the Commander profile
// (ROM_AUDIT_SAMPLE_RATE=48000, ROM_AUDIT_POWER_ON_DELAY=8191, ROM_AUDIT_REFERENCE_ONLY=1): the CPU path of a
// program that never reads a SID register depends on neither value.
unsigned rate = 8000;
unsigned powerOnDelay = 5000;
bool referenceOnly = false;
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
std::vector<uint8_t> payload(const std::string& encoded) {
    if(encoded.rfind("hex:",0)!=0 || encoded.size()%2!=0 || encoded.size()>2*1024*1024+4)
        throw std::runtime_error("invalid immutable SID payload");
    const auto digit=[](char c)->unsigned {
        if(c>='0'&&c<='9')return unsigned(c-'0');
        if(c>='a'&&c<='f')return unsigned(c-'a'+10);
        throw std::runtime_error("invalid SID payload hex digit");
    };
    std::vector<uint8_t> bytes;bytes.reserve((encoded.size()-4)/2);
    for(size_t i=4;i<encoded.size();i+=2)bytes.push_back(uint8_t((digit(encoded[i])<<4)|digit(encoded[i+1])));
    return bytes;
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
    size_t samples = 0;   // interleaved samples produced (pcm is not kept in reference-only mode)
    struct Write {unsigned chip, address, value; long long cycle;};
    std::vector<Write> writes;
    unsigned long long basicReads = 0, kernalReads = 0, chargenReads = 0, readbackReads = 0;
    bool traceComplete = true;
    std::string derivedFrom;
    std::string error;
    // "cpu-halt": the tune executed an illegal opcode (a property of the program).
    // "resource": allocation or size failure. "engine": any other engine report.
    // Only cpu-halt is evidence about the tune; the others are infrastructure.
    std::string errorKind;
};
std::vector<Render::Write>* trace = nullptr;
bool* traceComplete = nullptr;
constexpr size_t maxTraceWrites = 2000000;
std::map<const void*,unsigned> chips;
void observe(const void* chip, unsigned address, unsigned value, long long cycle) {
    if (!trace) return;
    if (!chips.count(chip)) chips[chip] = chips.size();
    if (trace->size() >= maxTraceWrites) { *traceComplete = false; return; }
    trace->push_back({chips[chip],address,value,cycle});
}
Render render(const std::vector<uint8_t>& bytes, unsigned song, double seconds,
              const uint8_t* kernal, const uint8_t* basic, const uint8_t* chargen) {
    Render result;
    sidflow_basic_reads = sidflow_kernal_reads = sidflow_chargen_reads = sidflow_sid_readback_reads = 0;
    try {
        chips.clear(); trace = &result.writes; traceComplete = &result.traceComplete;
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
        cfg.powerOnDelay = powerOnDelay; // below MAX_POWER_ON_DELAY (8191) disables the randomized delay
        if (!player.config(cfg)) throw std::runtime_error(player.error());
        player.setRoms(kernal, basic, chargen);
        if (tune.selectSong(song) != song) throw std::runtime_error("subtune selection mismatch");
        if (!player.load(&tune)) throw std::runtime_error(player.error());
        if (!player.reset()) throw std::runtime_error("reset failed");
        player.initMixer(true); // retain stereo differences / multi-SID panning
        // Ignore engine reset writes, retain everything the tune does in play().
        result.writes.clear(); chips.clear();
        const size_t wanted = static_cast<size_t>(std::llround(seconds * rate)) * 2;
        if (!referenceOnly) result.pcm.reserve(wanted);
        std::vector<int16_t> buffer;
        unsigned empty = 0;
        while (result.samples < wanted) {
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
            const size_t take = std::min(static_cast<size_t>(written), wanted - result.samples);
            if (!referenceOnly) result.pcm.insert(result.pcm.end(), buffer.begin(), buffer.begin() + take);
            result.samples += take;
        }
        player.load(nullptr); // tune is stack allocated after player
    } catch (const std::bad_alloc& error) {
        result.error = std::string("allocation failure: ") + error.what();
        result.errorKind = "resource";
        std::cerr << "render song " << song << ": " << result.error << '\n';
    } catch (const std::length_error& error) {
        result.error = std::string("size failure: ") + error.what();
        result.errorKind = "resource";
        std::cerr << "render song " << song << ": " << result.error << '\n';
    } catch (const std::exception& error) {
        result.error = error.what();
        result.errorKind = result.error.rfind("Illegal instruction $", 0) == 0 ? "cpu-halt" : "engine";
        std::cerr << "render song " << song << ": " << error.what() << '\n';
    }
    trace = nullptr;
    result.basicReads = sidflow_basic_reads;
    result.kernalReads = sidflow_kernal_reads;
    result.chargenReads = sidflow_chargen_reads;
    result.readbackReads = sidflow_sid_readback_reads;
    return result;
}
// Exact parity evidence is opt-in and confined to a private temporary control
// directory. Production workers still write no PCM/trace files.
void control(const Render& value, unsigned job, unsigned mask) {
    const char* dir=std::getenv("ROM_AUDIT_CONTROL_DIR");
    if (!dir) return;
    const auto name=std::string(dir)+"/"+std::to_string(job)+"-"+std::to_string(mask);
    std::ofstream pcm(name+".pcm",std::ios::binary), writes(name+".trace",std::ios::binary);
    if (!pcm || !writes) throw std::runtime_error("cannot open parity evidence output");
    const auto integer=[](std::ofstream& stream,uint64_t v,unsigned bytes) {
        for(unsigned i=0;i<bytes;++i)stream.put(static_cast<char>(uint8_t(v>>(8*i))));
    };
    for(auto sample:value.pcm)integer(pcm,uint16_t(sample),2);
    for(const auto& w:value.writes) {
        integer(writes,w.chip,8);integer(writes,w.address,8);
        integer(writes,w.value,8);integer(writes,uint64_t(w.cycle),8);
    }
    if (!pcm || !writes) throw std::runtime_error("cannot write complete parity evidence");
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
    std::cout << "{\"error\":" << quote(value.error) << ",\"errorKind\":" << quote(value.errorKind) << ",\"samples\":" << value.pcm.size()
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
    size_t exact = 0;
    uint64_t traceHash = 14695981039346656037ULL;
    for (const auto& w : value.writes) {
        for (uint64_t v : {uint64_t(w.chip), uint64_t(w.address), uint64_t(w.value), uint64_t(w.cycle)})
            for (unsigned b=0; b<8; ++b) { traceHash ^= uint8_t(v >> (b*8)); traceHash *= 1099511628211ULL; }
    }
    while (exact < traceCount) {
        const auto& a=value.writes[exact]; const auto& b=reference.writes[exact];
        if (a.chip!=b.chip || a.address!=b.address || a.value!=b.value || a.cycle!=b.cycle) break;
        ++exact;
    }
    std::cout << ",\"traceHash\":\"" << std::hex << traceHash << std::dec << "\",\"traceComplete\":" << (value.traceComplete ? "true" : "false")
        << ",\"firstWriteDivergence\":";
    if (exact == traceCount && value.writes.size()==reference.writes.size()) std::cout << "null";
    else {
        const auto event = [](const std::vector<Render::Write>& writes,size_t i) {
            if (i>=writes.size()) { std::cout << "null"; return; }
            const auto& w=writes[i]; std::cout << '[' << w.chip << ',' << w.address << ',' << w.value << ',' << w.cycle << ']';
        };
        std::cout << "{\"index\":" << exact << ",\"actual\":"; event(value.writes,exact);
        std::cout << ",\"reference\":"; event(reference.writes,exact); std::cout << '}';
    }
    std::cout << ",\"kernalReads\":" << value.kernalReads << ",\"chargenReads\":" << value.chargenReads;
    std::cout << ",\"sidWrites\":" << value.writes.size() << ",\"matchingWritePrefix\":" << matching
        << ",\"startupOffsetCycles\":" << offset << ",\"maxRelativeWriteDriftCycles\":" << maxDrift
        << ",\"sidReadbackReads\":" << value.readbackReads << ",\"basicReads\":" << value.basicReads << ",\"derivedFrom\":" << quote(value.derivedFrom);
    std::cout << '}';
}
}
int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("usage: render <ROM directory>");
        referenceOnly = std::getenv("ROM_AUDIT_REFERENCE_ONLY") != nullptr;
        if (const char* value = std::getenv("ROM_AUDIT_SAMPLE_RATE")) rate = static_cast<unsigned>(std::stoul(value));
        if (const char* value = std::getenv("ROM_AUDIT_POWER_ON_DELAY")) powerOnDelay = static_cast<unsigned>(std::stoul(value));
        if (rate < 4000 || rate > 192000 || powerOnDelay > SidConfig::MAX_POWER_ON_DELAY) throw std::runtime_error("invalid rate or power-on delay");
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
        unsigned jobIndex=0;
        while (std::getline(std::cin, line)) {
            size_t a = line.find('\t'), b = line.find('\t', a + 1);
            if (a == std::string::npos || b == std::string::npos) throw std::runtime_error("malformed input record");
            const std::string path = line.substr(0, a);
            const size_t c=line.find('\t',b+1);
            const auto songText=line.substr(a+1,b-a-1),durationText=line.substr(b+1,c==std::string::npos?c:c-b-1);
            size_t songEnd=0,durationEnd=0;
            const unsigned song=std::stoul(songText,&songEnd);
            const double seconds=std::stod(durationText,&durationEnd);
            if(path.empty()||songEnd!=songText.size()||durationEnd!=durationText.size())throw std::runtime_error("trailing or missing protocol fields");
            if (song < 1 || !std::isfinite(seconds) || seconds <= 0 || seconds > 3600)
                throw std::runtime_error("invalid song or duration");
            const auto bytes = c==std::string::npos?read(path):payload(line.substr(c+1));
            auto reference = render(bytes, song, seconds, kernal.data(), basic.data(), chargen.data());
            if (referenceOnly) {
                std::cout << "{\"path\":" << quote(path) << ",\"song\":" << song << ",\"seconds\":" << seconds << ",\"samples\":" << reference.samples
                    << ",\"error\":" << quote(reference.error) << ",\"errorKind\":" << quote(reference.errorKind) << ",\"writes\":" << reference.writes.size()
                    << ",\"traceComplete\":" << (reference.traceComplete ? "true" : "false") << ",\"sidReads\":" << reference.readbackReads << "}\n" << std::flush;
                ++jobIndex;
                continue;
            }
            control(reference,jobIndex,7);
            std::cout << "{\"path\":" << quote(path) << ",\"song\":" << song << ",\"seconds\":" << seconds << ",\"both\":";
            output(reference, reference);
            std::cout << ",\"repeat\":";
            // Keep only reference + one variant in memory; never eight PCM buffers.
            output(render(bytes,song,seconds,kernal.data(),basic.data(),chargen.data()),reference);
            std::cout << ",\"matrix\":[";
            const std::vector<uint8_t> absentChargen(4096,0);
            std::vector<std::string> measurements(8);
            for (unsigned mask=0; mask<8; ++mask) {
                if (mask) std::cout << ',';
                std::ostringstream encoded; auto* original=std::cout.rdbuf(encoded.rdbuf());
                if (mask==7) output(reference,reference);
                else { auto variant=render(bytes,song,seconds,mask&1?kernal.data():nullptr,
                    mask&2?basic.data():absentBasic.data(),mask&4?chargen.data():absentChargen.data());
                control(variant,jobIndex,mask); output(variant,reference); }
                std::cout.rdbuf(original); measurements[mask]=encoded.str(); std::cout << measurements[mask];
            }
            std::cout << ']';
            // Legacy fields retained for existing diagnostic consumers; no inferred
            // renders in v2. See matrix[0..7] for the complete experiment evidence.
            std::cout << ",\"neither\":";
            std::cout << measurements[4];
            std::cout << ",\"kernal\":";
            std::cout << measurements[5];
            std::cout << ",\"basic\":";
            std::cout << measurements[6];
            std::cout << "}\n" << std::flush;
            ++jobIndex;
        }
    } catch (const std::exception& error) {
        std::cerr << "ROM audit: " << error.what() << '\n'; return 1;
    }
}
