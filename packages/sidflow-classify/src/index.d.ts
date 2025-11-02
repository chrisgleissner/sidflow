import { type SidflowConfig } from "@sidflow/common";
export interface ClassifyOptions {
    configPath?: string;
    forceRebuild?: boolean;
}
export interface ClassificationPlan {
    config: SidflowConfig;
    wavCachePath: string;
    tagsPath: string;
    forceRebuild: boolean;
    classificationDepth: number;
    hvscPath: string;
    sidplayPath: string;
}
export declare function planClassification(options?: ClassifyOptions): Promise<ClassificationPlan>;
export declare function resolveWavPath(plan: ClassificationPlan, sidFile: string): string;
export declare function collectSidFiles(root: string): Promise<string[]>;
export declare function needsWavRefresh(sidFile: string, wavFile: string, forceRebuild: boolean): Promise<boolean>;
export interface RenderWavOptions {
    sidFile: string;
    wavFile: string;
    sidplayPath: string;
}
export type RenderWav = (options: RenderWavOptions) => Promise<void>;
export declare const defaultRenderWav: RenderWav;
export interface BuildWavCacheOptions {
    sidplayPath?: string;
    render?: RenderWav;
    forceRebuild?: boolean;
}
export interface BuildWavCacheResult {
    rendered: string[];
    skipped: string[];
}
export declare function buildWavCache(plan: ClassificationPlan, options?: BuildWavCacheOptions): Promise<BuildWavCacheResult>;
//# sourceMappingURL=index.d.ts.map