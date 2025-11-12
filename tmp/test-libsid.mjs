import { readFile } from 'node:fs/promises';
import { loadLibsidplayfp, SidAudioEngine } from '../packages/libsidplayfp-wasm/dist/index.js';

async function main() {
    const sidPath = new URL('../packages/libsidplayfp-wasm/test-tone-c4.sid', import.meta.url);
    const data = await readFile(sidPath);
    const engine = new SidAudioEngine({
        module: loadLibsidplayfp(),
        sampleRate: 48000,
        stereo: true,
    });
    await engine.loadSidBuffer(new Uint8Array(data));
    const pcm = await engine.renderFrames(48000, 40000);
    console.log('samples', pcm.length);
    console.log('min', Math.min(...pcm), 'max', Math.max(...pcm));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
