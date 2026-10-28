/** Experimental Linux fork isolation after immutable filter-table construction.
 * Input: SID path TAB song TAB seconds. Full-ROM reference only, <=32 jobs.
 * Output: native reference JSON and exact PCM/trace controls in output/job/.
 * Not a classifier or a production renderer replacement.
 */
#define main sidflow_original_main
#include "render.cpp"
#undef main
#include "FilterModelConfig6581.h"
#include "FilterModelConfig8580.h"
#include <filesystem>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::runtime_error("Expected ROM directory and control output directory");
        const auto started = std::clock();
        // Match SID::SID's filter construction order. No SID/player is reused.
        reSIDfp::FilterModelConfig6581::getInstance();
        reSIDfp::FilterModelConfig8580::getInstance();
        std::cerr << "{\"prewarmCpuSeconds\":" << double(std::clock()-started)/CLOCKS_PER_SEC << "}\n";
        unsigned index = 0;
        std::string line;
        while (std::getline(std::cin,line)) {
            if (++index > 32) throw std::runtime_error("32-job experiment ceiling exceeded");
            const auto dir = std::string(argv[2])+"/"+std::to_string(index);
            std::filesystem::create_directories(dir);
            std::cout.flush(); std::cerr.flush();
            const auto parent = getpid(), child = fork();
            if (child < 0) throw std::runtime_error("fork failed");
            if (child == 0) {
                prctl(PR_SET_PDEATHSIG,SIGKILL);
                if (getppid() != parent) _exit(1);
                std::istringstream input(line+"\n");
                std::cin.rdbuf(input.rdbuf()); std::cin.clear();
                setenv("ROM_AUDIT_REFERENCE_ONLY","1",1);
                setenv("ROM_AUDIT_CONTROL_DIR",dir.c_str(),1);
                setenv("ROM_AUDIT_SAMPLE_RATE","48000",1);
                setenv("ROM_AUDIT_POWER_ON_DELAY","8191",1);
                setenv("ROM_AUDIT_PULL_EVENTS","256",1);
                for (const char* name : {"ROM_AUDIT_SCREEN_MASK","ROM_AUDIT_STREAM_AUDIO","ROM_AUDIT_DIGITAL_ONLY","ROM_AUDIT_BUS_ONLY","ROM_AUDIT_WARMUP"}) unsetenv(name);
                const int code = sidflow_original_main(2,argv);
                std::cout.flush(); std::cerr.flush(); _exit(code);
            }
            int status = 0;
            rusage usage{};
            if (wait4(child,&status,0,&usage) != child || !WIFEXITED(status) || WEXITSTATUS(status)) throw std::runtime_error("Forked reference failed");
            const auto seconds = [](timeval t) { return t.tv_sec+t.tv_usec/1000000.0; };
            std::cerr << "{\"job\":" << index << ",\"childCpuSeconds\":" << seconds(usage.ru_utime)+seconds(usage.ru_stime) << "}\n";
        }
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
