import { createLogger, loadConfig, type SidflowConfig } from "@sidflow/common";

export interface TagCliOptions {
  configPath?: string;
  random?: boolean;
}

export interface TagSessionPlan {
  config: SidflowConfig;
  random: boolean;
  sidplayPath: string;
  tagsPath: string;
  hvscPath: string;
}

export async function planTagSession(
  options: TagCliOptions = {}
): Promise<TagSessionPlan> {
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
