import { loadConfig, stringifyDeterministic, type SidflowConfig } from "@sidflow/common";

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

export async function planClassification(
  options: ClassifyOptions = {}
): Promise<ClassificationPlan> {
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
