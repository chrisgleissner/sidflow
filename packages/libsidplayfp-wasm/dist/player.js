import { loadLibsidplayfp } from './index.js';
const DEFAULT_CACHE_SECONDS = 600;
export class SidAudioEngine {
    modulePromise;
    module;
    context;
    sampleRate;
    stereo;
    maxCacheSeconds;
    configured = false;
    originalSidBuffer = null;
    currentSongIndex = 0;
    cachePromise = null;
    cachedPcm = null;
    cacheSampleRate = 0;
    cacheChannels = 0;
    cacheCursor = 0;
    useCachePlayback = false;
    cacheToken = 0;
    constructor(options = {}) {
        const { module: moduleOverride, sampleRate, stereo, cacheSecondsLimit, ...loaderOptions } = options;
        this.sampleRate = sampleRate ?? 44100;
        this.stereo = stereo ?? true;
        this.maxCacheSeconds = cacheSecondsLimit ?? DEFAULT_CACHE_SECONDS;
        this.modulePromise = moduleOverride ?? loadLibsidplayfp(loaderOptions);
    }
    async ensureModule() {
        if (this.module) {
            return this.module;
        }
        this.module = await this.modulePromise;
        return this.module;
    }
    async createConfiguredContext() {
        const module = await this.ensureModule();
        const ctx = new module.SidPlayerContext();
        if (!ctx.configure(this.sampleRate, this.stereo)) {
            throw new Error(`Failed to configure SID player: ${ctx.getLastError()}`);
        }
        return ctx;
    }
    async loadPatchedBuffer(patched) {
        const ctx = await this.createConfiguredContext();
        if (!ctx.loadSidBuffer(patched)) {
            throw new Error(ctx.getLastError());
        }
        if (!ctx.reset()) {
            throw new Error(ctx.getLastError());
        }
        this.context = ctx;
        this.configured = true;
        return ctx;
    }
    cloneInput(data) {
        if (data instanceof Uint8Array) {
            return new Uint8Array(data);
        }
        return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    patchStartSong(buffer, songIndex) {
        if (buffer.length < 0x12) {
            throw new Error('SID buffer too small');
        }
        const headerOffset = 0x10;
        const patched = buffer.slice();
        const songs = (patched[0x0e] << 8) | patched[0x0f];
        const maxSong = songs > 0 ? songs : 1;
        const applied = Math.min(Math.max(1, Math.trunc(songIndex) + 1), maxSong);
        patched[headerOffset] = (applied >> 8) & 0xff;
        patched[headerOffset + 1] = applied & 0xff;
        return { data: patched, applied: applied - 1 };
    }
    async reloadCurrentSong() {
        if (!this.originalSidBuffer) {
            return 0;
        }
        const { data, applied } = this.patchStartSong(this.originalSidBuffer, this.currentSongIndex);
        await this.loadPatchedBuffer(data);
        this.currentSongIndex = applied;
        return applied;
    }
    async loadSidBuffer(data) {
        this.originalSidBuffer = this.cloneInput(data);
        this.currentSongIndex = 0;
        this.resetCacheState();
        await this.reloadCurrentSong();
        this.startCache();
    }
    async selectSong(songIndex) {
        if (!this.originalSidBuffer) {
            throw new Error('Load a SID before selecting a song');
        }
        this.currentSongIndex = Math.max(0, Math.trunc(songIndex));
        this.resetCacheState();
        const applied = await this.reloadCurrentSong();
        this.startCache();
        return applied;
    }
    getChannels() {
        if (!this.context) {
            throw new Error('SID player not initialized');
        }
        return this.context.getChannels();
    }
    getSampleRate() {
        if (!this.context) {
            throw new Error('SID player not initialized');
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
    renderCycles(cycles = 20000) {
        if (!this.context || !this.configured) {
            return null;
        }
        let chunk;
        try {
            chunk = this.context.render(cycles);
        }
        catch {
            return null;
        }
        if (chunk === null) {
            return null;
        }
        if (chunk.length === 0) {
            return new Int16Array(0);
        }
        return chunk.slice();
    }
    async renderSeconds(seconds, cyclesPerChunk = 20000, onProgress) {
        if (seconds <= 0) {
            throw new Error('Duration must be greater than zero');
        }
        if (!this.context || !this.configured) {
            return new Int16Array(0);
        }
        const requestedSamples = Math.max(1, Math.floor(this.sampleRate * seconds * (this.stereo ? 2 : 1)));
        if (this.useCachePlayback && this.cacheAvailable()) {
            const remaining = this.cachedPcm.length - this.cacheCursor;
            if (remaining <= 0) {
                return new Int16Array(0);
            }
            const toCopy = Math.min(requestedSamples, remaining);
            const chunk = this.cachedPcm.subarray(this.cacheCursor, this.cacheCursor + toCopy);
            this.cacheCursor += toCopy;
            return chunk.slice();
        }
        const context = this.context;
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
    async seekSeconds(seconds, cyclesPerChunk = 20000) {
        if (seconds <= 0) {
            this.useCachePlayback = this.cacheAvailable();
            this.cacheCursor = 0;
            await this.reloadCurrentSong();
            return 0;
        }
        if (this.cacheAvailable()) {
            const samplesPerSecond = this.cacheSampleRate * this.cacheChannels;
            const targetSample = Math.floor(samplesPerSecond * seconds);
            if (targetSample < this.cachedPcm.length) {
                this.useCachePlayback = true;
                this.cacheCursor = targetSample;
                return targetSample;
            }
        }
        this.useCachePlayback = false;
        await this.reloadCurrentSong();
        return this.fastForwardContext(seconds, cyclesPerChunk);
    }
    async waitForCacheReady() {
        if (this.cachePromise) {
            try {
                await this.cachePromise;
            }
            catch {
                return false;
            }
        }
        return this.cacheAvailable();
    }
    getCachedSegment(seconds, durationSeconds) {
        if (!this.cacheAvailable() || seconds < 0 || durationSeconds <= 0) {
            return null;
        }
        const samplesPerSecond = this.cacheSampleRate * this.cacheChannels;
        const start = Math.floor(samplesPerSecond * seconds);
        const length = Math.max(1, Math.floor(samplesPerSecond * durationSeconds));
        if (!this.cachedPcm || start + length > this.cachedPcm.length) {
            return null;
        }
        return this.cachedPcm.subarray(start, start + length).slice();
    }
    async fastForwardContext(seconds, cyclesPerChunk) {
        if (!this.context) {
            throw new Error('SID player not initialized');
        }
        const sampleRate = this.context.getSampleRate();
        const channels = this.context.getChannels();
        const targetSamples = Math.floor(sampleRate * channels * seconds);
        let skipped = 0;
        let iterations = 0;
        const maxIterations = Math.max(32, Math.ceil(targetSamples / cyclesPerChunk) * 4);
        while (skipped < targetSamples && iterations < maxIterations) {
            let chunk;
            try {
                chunk = this.context.render(cyclesPerChunk);
            }
            catch {
                break;
            }
            if (chunk === null || chunk.length === 0) {
                break;
            }
            skipped += chunk.length;
            iterations += 1;
        }
        return skipped;
    }
    resetCacheState() {
        this.cacheToken += 1;
        this.cachePromise = null;
        this.cachedPcm = null;
        this.cacheSampleRate = 0;
        this.cacheChannels = 0;
        this.cacheCursor = 0;
        this.useCachePlayback = false;
    }
    startCache() {
        if (!this.originalSidBuffer) {
            return;
        }
        const { data } = this.patchStartSong(this.originalSidBuffer, this.currentSongIndex);
        const token = this.cacheToken;
        const promise = this.buildCacheBuffer(data, token);
        this.cachePromise = promise;
        promise.finally(() => {
            if (this.cachePromise === promise) {
                this.cachePromise = null;
            }
        });
    }
    async buildCacheBuffer(buffer, token) {
        const module = await this.ensureModule();
        const ctx = new module.SidPlayerContext();
        if (!ctx.configure(this.sampleRate, this.stereo)) {
            return;
        }
        if (!ctx.loadSidBuffer(buffer)) {
            return;
        }
        if (!ctx.reset()) {
            return;
        }
        const channels = this.stereo ? 2 : 1;
        const maxSamples = Math.floor(this.sampleRate * channels * this.maxCacheSeconds);
        const chunks = [];
        let collected = 0;
        while (collected < maxSamples) {
            let chunk;
            try {
                chunk = ctx.render(20000);
            }
            catch {
                break;
            }
            if (chunk === null || chunk.length === 0) {
                break;
            }
            const copy = chunk.slice();
            chunks.push(copy);
            collected += copy.length;
        }
        if (this.cacheToken !== token) {
            return;
        }
        const combined = new Int16Array(collected);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        this.cachedPcm = combined;
        this.cacheSampleRate = this.sampleRate;
        this.cacheChannels = channels;
        this.cacheCursor = 0;
    }
    cacheAvailable() {
        return (!!this.cachedPcm &&
            this.cacheSampleRate === this.sampleRate &&
            this.cacheChannels === (this.stereo ? 2 : 1));
    }
}
//# sourceMappingURL=player.js.map