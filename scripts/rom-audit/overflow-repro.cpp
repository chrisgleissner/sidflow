// Standalone reproduction for the engine issue; no audit observers required.
// Link against libsidplayfp built from the package's complete-source archive.
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <sidplayfp/sidplayfp.h>
#include <sidplayfp/SidConfig.h>
#include <sidplayfp/SidTune.h>
#include <builders/sidlite-builder/sidlite.h>
// The distribution's trace patch requires this nullable symbol at link time.
extern "C" {
void (*sidflow_sid_write_hook)(const void*, unsigned, unsigned, long long) = nullptr;
// Unused by an ordinary archive build; resolves the audit build's passive counter.
unsigned long long sidflow_basic_reads = 0;
}
std::vector<uint8_t> bytes(const std::string& name) {
    std::ifstream f(name, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot open " + name);
    return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
}
int main(int argc, char** argv) {
    try {
        if (argc != 5) throw std::runtime_error("Usage: repro <SID> <ROM directory> <rate> <pull>");
        const auto sid = bytes(argv[1]); const std::string dir = argv[2];
        const auto k = bytes(dir + "/kernal.901227-03.bin");
        const auto b = bytes(dir + "/basic.901226-01.bin");
        const auto c = bytes(dir + "/characters.901225-01.bin");
        if (k.size()!=8192 || b.size()!=8192 || c.size()!=4096) throw std::runtime_error("Wrong ROM sizes");
        SidTune tune(sid.data(), sid.size());
        SIDLiteBuilder builder("repro"); sidplayfp player;
        SidConfig config; config.frequency = std::stoul(argv[3]);
        config.sidEmulation = &builder; config.powerOnDelay = 5000;
        config.digiBoost = true;
        if (!player.config(config)) throw std::runtime_error(player.error());
        player.setRoms(k.data(), b.data(), c.data()); tune.selectSong(1);
        if (!player.load(&tune) || !player.reset()) throw std::runtime_error(player.error());
        player.initMixer(true);
        unsigned samples = 0;
        while (samples < config.frequency * 2 * 2) {
            const int n = player.play(std::stoul(argv[4]));
            if (n < 0) throw std::runtime_error(player.error());
            std::vector<short> pcm(n * 2);
            samples += player.mix(pcm.data(), n);
        }
        player.load(nullptr); std::cout << "Completed " << samples << " samples\n";
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
