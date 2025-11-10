import { readFile } from 'node:fs/promises';
import { createSABRingBuffer, SABRingBufferProducer } from '../packages/sidflow-web/lib/audio/shared/sab-ring-buffer';
import { loadLibsidplayfp, SidAudioEngine } from '../packages/libsidplayfp-wasm/dist/index.js';

async function main() {
    const sidPath = new URL('../packages/libsidplayfp-wasm/test-tone-c4.sid', import.meta.url);
    const data = await readFile(sidPath);
    const sab = createSABRingBuffer({ capacityFrames: 16384, channelCount: 2 });
    const producer = new SABRingBufferProducer(sab);
    const engine = new SidAudioEngine({ module: loadLibsidplayfp(), sampleRate: 48000, stereo: true });
    await engine.loadSidBuffer(new Uint8Array(data));
    const alignedFrames = 2048;
    const available = producer.getAvailableWrite();
    console.log('available', available);
    const pcmInt16 = await engine.renderFrames(alignedFrames, 40000);
    console.log('pcm length', pcmInt16.length);
    const pcmFloat = new Float32Array(pcmInt16.length);
    for (let i = 0; i < pcmInt16.length; i++) {
        pcmFloat[i] = pcmInt16[i] / 32768;
    }
    const written = producer.write(pcmFloat);
    console.log('written', written);
    console.log('occupancy', producer.getOccupancy());
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
