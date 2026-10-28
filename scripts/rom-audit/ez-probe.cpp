/** Native libSidplayEZ timing/PCM probe. Experimental, never grants eligibility.
 * ez-probe <SID> <one-based song> <seconds> <ROM directory> <mask 0|3|7> <pcm>
 */
#include "player.h"
#include <algorithm>
#include <cmath>
#include <ctime>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <vector>
static std::vector<uint8_t> read(const std::string& name) {
    std::ifstream file(name, std::ios::binary);
    if (!file) throw std::runtime_error("Cannot read " + name);
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}
int main(int argc, char** argv) {
    try {
        if (argc != 7) throw std::runtime_error("Expected SID, song, seconds, ROM directory, mask, PCM output");
        const unsigned song = std::stoul(argv[2]);
        const double seconds = std::stod(argv[3]);
        const int mask = std::stoi(argv[5]);
        if (song < 1 || song > 256 || !std::isfinite(seconds) || seconds <= 0 || seconds > 3600 || (mask != 0 && mask != 3 && mask != 7)) throw std::runtime_error("Invalid probe input");
        const auto bytes = read(argv[1]);
        const std::string dir(argv[4]);
        auto k = read(dir + "/kernal.901227-03.bin"), b = read(dir + "/basic.901226-01.bin"), c = read(dir + "/characters.901225-01.bin");
        if (k.size() != 8192 || b.size() != 8192 || c.size() != 4096) throw std::runtime_error("Invalid ROM sizes");
        if (!(mask & 2)) std::fill(b.begin(), b.end(), 0);
        if (!(mask & 4)) std::fill(c.begin(), c.end(), 0);
        const auto start = std::clock();
        SidTune tune(bytes.data(), bytes.size());
        if (!tune.getStatus() || tune.selectSong(song) != song) throw std::runtime_error("Invalid tune or subtune");
        libsidplayfp::Player player;
        SidConfig config;
        config.frequency = 48000;
        config.defaultSidModel = SidConfig::MOS8580;
        player.setKernal(mask & 1 ? k.data() : nullptr);
        player.setBasic(b.data()); player.setChargen(c.data());
        if (!player.setConfig(config) || !player.loadTune(&tune)) throw std::runtime_error(player.error());
        const auto loaded = std::clock();
        const size_t wanted = std::llround(seconds * 48000);
        std::vector<float> left(4096), right(4096);
        std::vector<int16_t> pcm(8192);
        std::ofstream out(argv[6], std::ios::binary);
        if (!out) throw std::runtime_error("Cannot create PCM output");
        size_t frames = 0;
        while (frames < wanted) {
            const size_t count = std::min(size_t(4096), wanted - frames);
            const auto got = player.play(std::span<float>(left.data(), count), std::span<float>(right.data(), count), {});
            if (got == 0 || got > count || player.isJammed()) throw std::runtime_error("Engine stopped before horizon");
            for (size_t i = 0; i < got; ++i) for (size_t channel = 0; channel < 2; ++channel) {
                const float sample = (channel ? right[i] : left[i]) * 32768.f;
                if (!std::isfinite(sample)) throw std::runtime_error("Nonfinite PCM");
                pcm[2*i+channel] = static_cast<int16_t>(std::lrint(std::clamp(sample,-32768.f,32767.f)));
            }
            out.write(reinterpret_cast<const char*>(pcm.data()), got * 4);
            if (!out) throw std::runtime_error("PCM write failed");
            frames += got;
        }
        player.loadTune(nullptr);
        std::cout << "{\"frames\":" << frames << ",\"loadCpuSeconds\":" << double(loaded-start)/CLOCKS_PER_SEC
                  << ",\"renderCpuSeconds\":" << double(std::clock()-loaded)/CLOCKS_PER_SEC << "}\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
