#!/usr/bin/env bash
# Build an isolated, explicitly labelled frame-count experiment. Existing native
# renderers/sources are not patched or replaced. No placeholder PCM is exported.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
experiment="$root/workspace/rom-audit-sample-clock"
mkdir -p "$experiment/scripts/rom-audit"
cp "$root/scripts/rom-audit/"{build-native.sh,render.cpp,apply-sid-write-hook.py,apply-basic-read-hook.py,apply-digital-screen.py,apply-inline-filters.py,apply-sample-clock.py} "$experiment/scripts/rom-audit/"
python3 - "$experiment" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1]); directory=root/'scripts/rom-audit'
p=directory/'build-native.sh';s=p.read_text()
s=s.replace('"$root/scripts/rom-audit/render.cpp" "${BASH_SOURCE[0]}"','"$root/scripts/rom-audit/render.cpp" "${BASH_SOURCE[0]}"')
s=s.replace('sha256sum "$source_archive"', 'sha256sum "$root/scripts/rom-audit/apply-sample-clock.py" "$source_archive"')
s=s.replace('  if [[ "$engine" == residfp ]]; then\n    cd', '  python3 "$root/scripts/rom-audit/apply-sample-clock.py" "$source_dir"\n  if [[ "$engine" == residfp ]]; then\n    cd',1)
p.write_text(s)
p=directory/'render.cpp';s=p.read_text()
s=s.replace('    std::vector<int16_t> pendingPcm;', '    std::vector<int16_t> pendingPcm;\n    size_t pendingSampleClock = 0;')
s=s.replace('bool sidflow_digital_only = false;', 'bool sidflow_digital_only = false;\nbool sidflow_sample_clock = true;')
s=s.replace('if (sidflow_digital_only) {\n                // No mixer', 'if (sidflow_digital_only && !sidflow_sample_clock) {\n                // No mixer',1)
old='            if (retainPcm) result.pcm.insert'
insert='''            if (sidflow_sample_clock) {
                pendingSampleClock += take;
                if (pendingSampleClock >= 8192 || result.samples+take == wanted) {
                std::cout << "{\\"sampleClockFrames\\":" << pendingSampleClock/2 << ",\\"writes\\":[";
                bool first=true;
                for (const auto& w:result.writes) {
                    if (!first) std::cout << ','; first=false;
                    std::cout << w.chip << ',' << w.address << ',' << w.value << ',' << w.cycle;
                }
                std::cout << "]}\\n";
                result.writes.clear(); pendingSampleClock = 0;
                }
                result.samples += take; continue;
            }
'''
assert s.count(old)==1;s=s.replace(old,insert+old)
s=s.replace('<< ",\\"chargenReads\\":" << value.chargenReads << ",\\"writes\\":[";', '<< ",\\"sampleClockComplete\\":true,\\"chargenReads\\":" << value.chargenReads << ",\\"writes\\":[";')
p.write_text(s)
PY
ROM_AUDIT_ENGINE=residfp ROM_AUDIT_BUILD_DIR="$experiment/native" \
  ROM_AUDIT_PACKAGE="$root/node_modules/libsidplayfp-wasm-audit" \
  bash "$experiment/scripts/rom-audit/build-native.sh"
mapfile -t archives < <(find "$experiment/native" -path '*/prefix/lib/libresidfp.a')
((${#archives[@]} == 1)) || { echo "Expected one experimental reSIDfp archive" >&2; exit 1; }
build=${archives[0]%/prefix/lib/libresidfp.a}
mapfile -t headers < <(find "$build" -path '*/libresidfp/src/resample/TwoPassSincResampler.h')
((${#headers[@]} == 1)) || { echo "Expected one experimental resampler source" >&2; exit 1; }
resid_source=${headers[0]%/resample/TwoPassSincResampler.h}
g++ -std=c++17 -O3 -march=native -ffp-contract=off -flto -I"$resid_source" \
  "$root/scripts/rom-audit/sample-clock-count-test.cpp" "${archives[0]}" -o "$experiment/count-test"
"$experiment/count-test"
