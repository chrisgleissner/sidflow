export interface SidflowConfig {
    hvscPath: string;
    wavCachePath: string;
    tagsPath: string;
    sidplayPath?: string;
    threads: number;
    classificationDepth: number;
}
export declare const DEFAULT_CONFIG_FILENAME = ".sidflow.json";
export declare class SidflowConfigError extends Error {
    cause?: unknown;
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
export declare function getDefaultConfigPath(cwd?: string): string;
export declare function resetConfigCache(): void;
export declare function loadConfig(configPath?: string): Promise<SidflowConfig>;
export declare function getCachedConfig(): SidflowConfig;
//# sourceMappingURL=config.d.ts.map