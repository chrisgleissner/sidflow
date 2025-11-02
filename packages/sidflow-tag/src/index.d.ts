import { type SidflowConfig } from "@sidflow/common";
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
export declare function planTagSession(options?: TagCliOptions): Promise<TagSessionPlan>;
//# sourceMappingURL=index.d.ts.map