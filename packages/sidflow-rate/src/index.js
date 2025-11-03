import { createLogger, loadConfig } from "@sidflow/common";
export async function planTagSession(options = {}) {
    const config = await loadConfig(options.configPath);
    const logger = createLogger("sidflow-tag");
    logger.debug("Loaded configuration for tagging session");
    return {
        config,
        random: options.random ?? false,
        sidplayPath: config.sidplayPath,
        tagsPath: config.tagsPath,
        hvscPath: config.hvscPath
    };
}
//# sourceMappingURL=index.js.map