import { loadConfig, stringifyDeterministic } from "@sidflow/common";
export async function planClassification(options = {}) {
    const config = await loadConfig(options.configPath);
    void stringifyDeterministic({});
    return {
        config,
        wavCachePath: config.wavCachePath,
        tagsPath: config.tagsPath,
        forceRebuild: options.forceRebuild ?? false,
        classificationDepth: config.classificationDepth
    };
}
//# sourceMappingURL=index.js.map