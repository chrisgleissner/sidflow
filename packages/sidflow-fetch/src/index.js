import { loadConfig } from "@sidflow/common";
export async function createFetchBootstrap(options = {}) {
    const config = await loadConfig(options.configPath);
    return {
        config,
        sidPath: config.sidPath,
        wavCachePath: config.wavCachePath,
        tagsPath: config.tagsPath
    };
}
//# sourceMappingURL=index.js.map