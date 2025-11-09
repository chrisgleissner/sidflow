import { loadLibsidplayfp } from "./index.js";
export class SidAudioEngine {
    modulePromise;
    module;
    context;
    sampleRate;
    stereo;
    configured = false;
    constructor(options = {}) {
        const { module: moduleOverride, sampleRate, stereo, ...loaderOptions } = options;
        this.sampleRate = sampleRate ?? 44_100;
        this.stereo = stereo ?? true;
        this.modulePromise = moduleOverride ?? loadLibsidplayfp(loaderOptions);
    }
    async ensureContext() {
        if (this.context) {
            return this.context;
        }
        this.module = await this.modulePromise;
        this.context = new this.module.SidPlayerContext();
        if (!this.context.configure(this.sampleRate, this.stereo)) {
            throw new Error(`Failed to configure SID player: ${this.context.getLastError()}`);
        }
        this.configured = true;
        return this.context;
    }
    async loadSidBuffer(data) {
        const context = await this.ensureContext();
        const payload = data instanceof Uint8Array ? data : new Uint8Array(data.buffer);
        if (!context.loadSidBuffer(payload)) {
            throw new Error(context.getLastError());
        }
    }
    selectSong(songIndex) {
        if (!this.context) {
            throw new Error("SID player not initialized");
        }
        return this.context.selectSong(songIndex);
    }
    getChannels() {
        if (!this.context) {
            throw new Error("SID player not initialized");
        }
        return this.context.getChannels();
    }
    getSampleRate() {
        if (!this.context) {
            throw new Error("SID player not initialized");
        }
        return this.context.getSampleRate();
    }
    getTuneInfo() {
        if (!this.context) {
            return null;
        }
        return this.context.getTuneInfo();
    }
    reset() {
        if (!this.context) {
            return;
        }
        this.context.reset();
    }
    renderCycles(cycles = 20_000) {
        if (!this.context || !this.configured) {
            return null;
        }
        const chunk = this.context.render(cycles);
        if (chunk === null) {
            return null;
        }
        if (chunk.length === 0) {
            return new Int16Array(0);
        }
        return chunk.slice();
    }
    async renderSeconds(seconds, cyclesPerChunk = 20_000, onProgress) {
        if (seconds <= 0) {
            throw new Error("Duration must be greater than zero");
        }
        const context = await this.ensureContext();
        const sampleRate = context.getSampleRate();
        const channels = context.getChannels();
        const totalSamples = Math.max(1, Math.floor(sampleRate * seconds * channels));
        const buffer = new Int16Array(totalSamples);
        let offset = 0;
        const maxIterations = Math.ceil((sampleRate * seconds) / cyclesPerChunk) * 4;
        let iterations = 0;
        while (offset < totalSamples && iterations < maxIterations) {
            iterations += 1;
            const chunk = this.renderCycles(cyclesPerChunk);
            if (chunk === null) {
                break;
            }
            if (chunk.length === 0) {
                continue;
            }
            const available = Math.min(chunk.length, totalSamples - offset);
            buffer.set(chunk.subarray(0, available), offset);
            offset += available;
            onProgress?.(offset);
        }
        return buffer.subarray(0, offset);
    }
}
//# sourceMappingURL=player.js.map