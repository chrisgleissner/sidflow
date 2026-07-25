#include <algorithm>
#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <config.h>
#include <sidplayfp/sidplayfp.h>
#include <sidplayfp/SidConfig.h>
#include <sidplayfp/SidInfo.h>
#include <sidplayfp/SidTune.h>
#include <sidplayfp/SidTuneInfo.h>
#include <sidplayfp/sidbuilder.h>

#include <sidemu.h>

// The engine must be reSIDfp. Since libsidplayfp v3.x reSIDfp lives in an
// external library (configure.ac: PKG_CHECK_MODULES([RESIDFP], [libresidfp])),
// and HAVE_RESIDFP is defined only when pkg-config finds it. For a long time
// this build never provided libresidfp, so it silently fell back to SIDLite —
// a fast approximation that measurably does not sound like a C64 (see
// c64commander docs/plans/sid-station/AUDIO-FIDELITY-TEST.md).
//
// Fail the build rather than ship that fallback by accident. Comparison
// artifacts can still be produced deliberately with -DSIDFLOW_ALLOW_SIDLITE.
#if !defined(HAVE_RESIDFP) && !defined(SIDFLOW_ALLOW_SIDLITE)
#error "libresidfp not found: this build would silently fall back to SIDLite. \
Build libresidfp into the emscripten sysroot so pkg-config defines HAVE_RESIDFP, \
or set SIDFLOW_ALLOW_SIDLITE=1 to deliberately build a SIDLite comparison artifact."
#endif

#ifdef HAVE_RESIDFP
#include <residfp.h>
#else
#include <sidlite.h>
#endif

#ifdef HAVE_RESIDFP
using DefaultSidBuilder = ReSIDfpBuilder;
static constexpr const char *kDefaultBuilderName = "WasmReSIDfp";
#else
using DefaultSidBuilder = SIDLiteBuilder;
static constexpr const char *kDefaultBuilderName = "WasmSIDLite";
#endif

namespace
{
    constexpr uint32_t kDefaultSampleRate = 44100;
    constexpr bool kDefaultStereo = true;

    struct SidWriteTraceRecord
    {
        uint32_t sidNumber;
        uint32_t address;
        uint32_t value;
        uint32_t cyclePhi1;
    };

    emscripten::val makeEmptyInt16Array()
    {
        return emscripten::val::global("Int16Array").new_(0);
    }

    size_t extractLength(const emscripten::val &value)
    {
        if (value.isUndefined() || value.isNull())
        {
            return 0;
        }

        const emscripten::val lengthVal = value["length"];
        if (!lengthVal.isUndefined() && !lengthVal.isNull())
        {
            return lengthVal.as<size_t>();
        }

        const emscripten::val byteLengthVal = value["byteLength"];
        if (!byteLengthVal.isUndefined() && !byteLengthVal.isNull())
        {
            return byteLengthVal.as<size_t>();
        }

        return 0;
    }
}

// SID register write tracing.
//
// This used to be a `TracingSidEmu`: a libsidplayfp::sidemu subclass that
// wrapped a real emulation and mirrored its buffer state. That was broken.
// `sidemu::bufferpos()` is not virtual, and player.cpp drives the consume cycle
// through it (`sampleCount = s->bufferpos(); s->bufferpos(0);`), so the reset
// landed on the wrapper while samples were produced into the inner emulation's
// buffer. The inner cursor was never reset, grew without bound, walked off the
// end of its buffer, and fed the mixer an ever-growing stale sample count.
//
// There is no wrapper any more. The builder hands out upstream's own emulation
// object untouched — the audio path is byte-for-byte libsidplayfp's — and
// tracing is a nullable function pointer consulted inside the patched
// `sidemu::writeReg` (see scripts/apply-sid-write-hook.py), the single funnel
// every CPU SID register write already passes through. Observation only: with
// the hook unset, which is the default and the only mode the C64 Commander app
// uses, the emulation is exactly upstream's.
extern "C" void (*sidflow_sid_write_hook)(const void *emu, unsigned int addr,
                                          unsigned int data, long long cyclePhi1) = nullptr;

class SidWriteTraceBuilder final : public DefaultSidBuilder
{
public:
    SidWriteTraceBuilder(const char *name, std::vector<SidWriteTraceRecord> *traceSink, bool *traceEnabled)
        : DefaultSidBuilder(name),
          traceSink(traceSink),
          traceEnabled(traceEnabled)
    {
    }

    ~SidWriteTraceBuilder() override
    {
        for (const auto &entry : sidNumbers)
        {
            registry().erase(entry.first);
        }
    }

    // SID numbers are assigned when the emulation is created and stay stable for
    // its lifetime, so they survive libsidplayfp reusing a chip from its pool
    // across reconfigurations. Nothing to reset beyond the trace buffer itself,
    // which the caller clears.
    void resetTraceState() {}

    void record(const void *emu, unsigned int addr, unsigned int data, long long cyclePhi1)
    {
        if (traceEnabled == nullptr || !*traceEnabled || traceSink == nullptr)
        {
            return;
        }

        const auto known = sidNumbers.find(emu);
        traceSink->push_back(SidWriteTraceRecord{
            known != sidNumbers.end() ? known->second : 0u,
            static_cast<uint32_t>(addr & 0x1f),
            static_cast<uint32_t>(data),
            static_cast<uint32_t>(cyclePhi1),
        });
    }

    // Maps an emulation instance back to the builder that created it, so the
    // hook can attribute a write without the emulation knowing about tracing.
    static std::map<const void *, SidWriteTraceBuilder *> &registry()
    {
        static std::map<const void *, SidWriteTraceBuilder *> instance;
        return instance;
    }

protected:
    libsidplayfp::sidemu *create() override
    {
        libsidplayfp::sidemu *emu = DefaultSidBuilder::create();
        if (emu != nullptr)
        {
            // Assigning over any previous entry keeps this correct when the
            // allocator reuses the address of a removed emulation.
            sidNumbers[emu] = nextSidNumber++;
            registry()[emu] = this;
        }
        return emu;
    }

private:
    std::vector<SidWriteTraceRecord> *traceSink;
    bool *traceEnabled;
    uint32_t nextSidNumber = 0;
    std::map<const void *, uint32_t> sidNumbers;
};

namespace
{
    void sidflowSidWriteHook(const void *emu, unsigned int addr, unsigned int data, long long cyclePhi1)
    {
        auto &registry = SidWriteTraceBuilder::registry();
        const auto owner = registry.find(emu);
        if (owner != registry.end())
        {
            owner->second->record(emu, addr, data, cyclePhi1);
        }
    }

    // The hook is installed only while something is actually tracing, so a
    // player that never asks for traces runs with the pointer null.
    unsigned int traceConsumers = 0;

    void retainWriteHook()
    {
        if (traceConsumers++ == 0)
        {
            sidflow_sid_write_hook = &sidflowSidWriteHook;
        }
    }

    void releaseWriteHook()
    {
        if (traceConsumers > 0 && --traceConsumers == 0)
        {
            sidflow_sid_write_hook = nullptr;
        }
    }
}

class SidPlayerContext
{
public:
    SidPlayerContext()
                : builder(std::make_unique<SidWriteTraceBuilder>(kDefaultBuilderName, &sidWriteTrace, &traceEnabled)),
          stereo(kDefaultStereo),
          channels(kDefaultStereo ? 2u : 1u),
          sampleRate(kDefaultSampleRate),
          configured(false)
    {
    }

    ~SidPlayerContext()
    {
        // Balance the hook refcount so a context destroyed while tracing does
        // not leave the hook installed for players that never asked for it.
        if (traceEnabled)
        {
            releaseWriteHook();
        }
    }

    bool configure(uint32_t frequency, bool stereoPlayback)
    {
        if (!builder)
        {
            lastError = "SID builder not initialized";
            return false;
        }

        sampleRate = frequency;
        stereo = stereoPlayback;
        channels = stereo ? 2u : 1u;

        SidConfig cfg;
        cfg.frequency = sampleRate;
        // Since v3.0.0 stereo is purely a mixer concern (SidConfig::playback and
        // MONO/STEREO were removed); initMixer(stereo) below selects it.
        cfg.sidEmulation = builder.get();
        cfg.samplingMethod = SidConfig::RESAMPLE_INTERPOLATE;
        cfg.digiBoost = true;
        // Ensure deterministic output: libsidplayfp defaults to a random power-on delay
        // (DEFAULT_POWER_ON_DELAY = MAX + 1). Keeping it <= MAX yields constant results.
        cfg.powerOnDelay = SidConfig::MAX_POWER_ON_DELAY;

        builder->resetTraceState();
        clearSidWriteTrace();

        if (!player.config(cfg))
        {
            lastError = player.error();
            configured = false;
            return false;
        }

        refreshMixer();
        configured = true;
        return true;
    }

    bool loadSidFile(const std::string &path)
    {
        tune = std::make_unique<SidTune>(path.c_str());
        if (!tune->getStatus())
        {
            lastError = tune->statusString();
            tune.reset();
            return false;
        }

        return finalizeTuneLoad();
    }

    bool loadSidBuffer(emscripten::val data)
    {
        const size_t length = extractLength(data);

        if (length == 0)
        {
            lastError = "Buffer length is zero";
            return false;
        }

        tuneBuffer.resize(length);
        emscripten::val view = emscripten::val(emscripten::typed_memory_view(length, tuneBuffer.data()));
        view.call<void>("set", data);

        tune = std::make_unique<SidTune>(tuneBuffer.data(), static_cast<uint32_t>(tuneBuffer.size()));
        if (!tune->getStatus())
        {
            lastError = tune->statusString();
            tune.reset();
            return false;
        }

        return finalizeTuneLoad();
    }

    unsigned int selectSong(unsigned int song)
    {
        if (!tune)
        {
            return 0U;
        }

        const unsigned int selected = tune->selectSong(song);
        if (!player.load(tune.get()))
        {
            lastError = player.error();
            return 0U;
        }

        if (!player.reset())
        {
            lastError = player.error();
        }

        // MUST come after load(). See refreshMixer().
        refreshMixer();

        clearSidWriteTrace();

        return selected;
    }

    emscripten::val render(unsigned int cycles)
    {
        if (!tune || !configured)
        {
            return emscripten::val::null();
        }

        const int produced = player.play(cycles);
        if (produced < 0)
        {
            lastError = player.error();
            return emscripten::val::null();
        }

        if (produced == 0)
        {
            return makeEmptyInt16Array();
        }

        const size_t requiredSamples = static_cast<size_t>(produced) * channels;
        if (mixBuffer.size() < requiredSamples)
        {
            mixBuffer.resize(requiredSamples);
        }

        const unsigned int written = player.mix(mixBuffer.data(), static_cast<unsigned int>(produced));
        if (written == 0)
        {
            return makeEmptyInt16Array();
        }

        // player.mix() returns the number of samples written, which already includes channel multiplication
        return emscripten::val(emscripten::typed_memory_view(static_cast<size_t>(written), mixBuffer.data()));
    }

    bool reset()
    {
        if (!player.reset())
        {
            lastError = player.error();
            return false;
        }
        clearSidWriteTrace();
        return true;
    }

    void setSidWriteTraceEnabled(bool enabled)
    {
        if (enabled == traceEnabled)
        {
            return;
        }

        traceEnabled = enabled;
        if (traceEnabled)
        {
            retainWriteHook();
        }
        else
        {
            releaseWriteHook();
            clearSidWriteTrace();
        }
    }

    emscripten::val getAndClearSidWriteTraces()
    {
        emscripten::val traces = emscripten::val::array();
        for (size_t index = 0; index < sidWriteTrace.size(); ++index)
        {
            const SidWriteTraceRecord &trace = sidWriteTrace[index];
            emscripten::val entry = emscripten::val::object();
            entry.set("sidNumber", trace.sidNumber);
            entry.set("address", trace.address);
            entry.set("value", trace.value);
            entry.set("cyclePhi1", trace.cyclePhi1);
            traces.set(index, entry);
        }
        clearSidWriteTrace();
        return traces;
    }

    bool hasTune() const
    {
        return static_cast<bool>(tune);
    }

    bool isStereo() const
    {
        return stereo;
    }

    unsigned int getChannels() const
    {
        return channels;
    }

    uint32_t getSampleRate() const
    {
        return sampleRate;
    }

    std::string getLastError() const
    {
        return lastError;
    }

    emscripten::val getTuneInfo() const
    {
        if (!tune)
        {
            return emscripten::val::null();
        }

        const SidTuneInfo *info = tune->getInfo();
        if (!info)
        {
            return emscripten::val::null();
        }

        emscripten::val obj = emscripten::val::object();
        obj.set("songs", info->songs());
        obj.set("startSong", info->startSong());
        obj.set("currentSong", info->currentSong());
        obj.set("loadAddress", info->loadAddr());
        obj.set("initAddress", info->initAddr());
        obj.set("playAddress", info->playAddr());
        obj.set("dataFileLen", info->dataFileLen());
        obj.set("c64dataLen", info->c64dataLen());
        obj.set("clockSpeed", static_cast<int>(info->clockSpeed()));
        obj.set("format", info->formatString() ? info->formatString() : "");

        emscripten::val infoStrings = emscripten::val::array();
        const unsigned int infoCount = info->numberOfInfoStrings();
        for (unsigned int i = 0; i < infoCount; ++i)
        {
            const char *str = info->infoString(i);
            infoStrings.set(i, str ? str : "");
        }
        obj.set("infoStrings", infoStrings);

        emscripten::val commentStrings = emscripten::val::array();
        const unsigned int commentCount = info->numberOfCommentStrings();
        for (unsigned int i = 0; i < commentCount; ++i)
        {
            const char *str = info->commentString(i);
            commentStrings.set(i, str ? str : "");
        }
        obj.set("commentStrings", commentStrings);

        return obj;
    }

    emscripten::val getEngineInfo() const
    {
        const SidInfo &info = player.info();
        emscripten::val obj = emscripten::val::object();
        obj.set("name", info.name() ? info.name() : "");
        obj.set("version", info.version() ? info.version() : "");
        // SidInfo::channels() was removed in v3.0.0; the channel count is now
        // decided by the mixer, which we configure from `stereo`.
        obj.set("channels", channels);
        obj.set("driverAddress", info.driverAddr());
        obj.set("driverLength", info.driverLength());
        obj.set("powerOnDelay", info.powerOnDelay());
        obj.set("speed", info.speedString() ? info.speedString() : "");

        emscripten::val creditsArray = emscripten::val::array();
        const unsigned int creditsCount = info.numberOfCredits();
        for (unsigned int i = 0; i < creditsCount; ++i)
        {
            const char *credit = info.credits(i);
            creditsArray.set(i, credit ? credit : "");
        }
        obj.set("credits", creditsArray);

        obj.set("kernal", info.kernalDesc() ? info.kernalDesc() : "");
        obj.set("basic", info.basicDesc() ? info.basicDesc() : "");
        obj.set("chargen", info.chargenDesc() ? info.chargenDesc() : "");

        obj.set("sidChips", info.numberOfSIDs());

        return obj;
    }

    bool setSystemROMs(emscripten::val kernal, emscripten::val basic, emscripten::val chargen)
    {
        const auto copyRom = [&](emscripten::val src, std::vector<uint8_t> &target, size_t expectedSize, const char *name) -> bool
        {
            if (src.isUndefined() || src.isNull())
            {
                target.clear();
                return true;
            }

            const size_t length = extractLength(src);
            if (length == 0)
            {
                lastError = std::string(name) + " buffer length is zero";
                return false;
            }

            if ((expectedSize != 0) && (length != expectedSize))
            {
                lastError = std::string(name) + " buffer expected " + std::to_string(expectedSize) + " bytes";
                return false;
            }

            target.resize(length);
            emscripten::val view = emscripten::val(emscripten::typed_memory_view(length, target.data()));
            view.call<void>("set", src);
            return true;
        };

        if (!copyRom(kernal, kernalRom, 8192, "KERNAL ROM"))
        {
            return false;
        }
        if (!copyRom(basic, basicRom, 8192, "BASIC ROM"))
        {
            return false;
        }
        if (!copyRom(chargen, chargenRom, 4096, "CHARGEN ROM"))
        {
            return false;
        }

        const uint8_t *kernalPtr = kernalRom.empty() ? nullptr : kernalRom.data();
        const uint8_t *basicPtr = basicRom.empty() ? nullptr : basicRom.data();
        const uint8_t *chargenPtr = chargenRom.empty() ? nullptr : chargenRom.data();

        player.setRoms(kernalPtr, basicPtr, chargenPtr);

        if (tune)
        {
            if (!player.reset())
            {
                lastError = player.error();
                return false;
            }

            refreshMixer();
        }

        return true;
    }

private:
    /**
     * Re-point the mixer at the SID chips' sample buffers.
     *
     * This must be called after *every* player.config() or player.load(), and
     * getting it wrong is silent and destructive. sidplayfp::initMixer() caches
     * each chip's raw `short*` (player.cpp: `buffers[i] = m_chips[i]->buffer()`),
     * while player.load() re-runs config() ("Must re-configure on fly for stereo
     * support!"), which reaches reSIDfpEmu::sampling() and does
     * `delete[] m_buffer; m_buffer = new short[...]`. Any mixer initialised
     * before that point is left holding freed pointers, and every subsequent
     * mix() reads freed memory.
     *
     * That is not theoretical: AddressSanitizer caught it as a heap-use-after-free
     * reading a 1920-byte region — exactly `new short[960]`, the 20 ms buffer for
     * 48 kHz. selectSong() used to call load() without re-initialising the mixer,
     * so the app hit it on every tune. The audible result was an engine that
     * played the right notes at the right time but with ~10 dB of excess high
     * frequency, and whose output changed with the render chunk size because the
     * contents of the freed region depend on allocator activity.
     */
    void refreshMixer()
    {
        if (player.installedSIDs() > 0U)
        {
            player.initMixer(stereo);
        }
    }

    void clearSidWriteTrace()
    {
        sidWriteTrace.clear();
    }

    bool finalizeTuneLoad()
    {
        if (!configured && !configure(sampleRate, stereo))
        {
            return false;
        }

        tune->selectSong(0);

        builder->resetTraceState();
        clearSidWriteTrace();

        if (!player.load(tune.get()))
        {
            lastError = player.error();
            tune.reset();
            return false;
        }

        if (!player.reset())
        {
            lastError = player.error();
            return false;
        }

        refreshMixer();

        return true;
    }

    sidplayfp player;
    std::unique_ptr<SidWriteTraceBuilder> builder;
    std::unique_ptr<SidTune> tune;
    std::vector<uint8_t> tuneBuffer;
    std::vector<int16_t> mixBuffer;
    std::vector<uint8_t> kernalRom;
    std::vector<uint8_t> basicRom;
    std::vector<uint8_t> chargenRom;
    bool stereo;
    unsigned int channels;
    uint32_t sampleRate;
    bool configured;
    bool traceEnabled = false;
    std::string lastError;
    std::vector<SidWriteTraceRecord> sidWriteTrace;
};

EMSCRIPTEN_BINDINGS(libsidplayfp_wasm)
{
    emscripten::class_<SidPlayerContext>("SidPlayerContext")
        .constructor<>()
        .function("configure", &SidPlayerContext::configure)
        .function("loadSidFile", &SidPlayerContext::loadSidFile)
        .function("loadSidBuffer", &SidPlayerContext::loadSidBuffer)
        .function("selectSong", &SidPlayerContext::selectSong)
        .function("render", &SidPlayerContext::render)
        .function("reset", &SidPlayerContext::reset)
        .function("setSidWriteTraceEnabled", &SidPlayerContext::setSidWriteTraceEnabled)
        .function("getAndClearSidWriteTraces", &SidPlayerContext::getAndClearSidWriteTraces)
        .function("hasTune", &SidPlayerContext::hasTune)
        .function("isStereo", &SidPlayerContext::isStereo)
        .function("getChannels", &SidPlayerContext::getChannels)
        .function("getSampleRate", &SidPlayerContext::getSampleRate)
        .function("getLastError", &SidPlayerContext::getLastError)
        .function("getTuneInfo", &SidPlayerContext::getTuneInfo)
        .function("getEngineInfo", &SidPlayerContext::getEngineInfo)
        .function("setSystemROMs", &SidPlayerContext::setSystemROMs);
}
