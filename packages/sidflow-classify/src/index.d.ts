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
}
export declare function planClassification(options?: ClassifyOptions): Promise<ClassificationPlan>;
//# sourceMappingURL=index.d.ts.map