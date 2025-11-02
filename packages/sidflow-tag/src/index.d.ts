import { type SidflowConfig } from "@sidflow/common";
export interface TagRatings {
    s: number;
    m: number;
    c: number;
}
export interface KeyState {
    ratings: TagRatings;
    pendingDimension?: keyof TagRatings;
}
export type KeyAction = "none" | "save" | "quit";
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
export declare const DEFAULT_RATINGS: TagRatings;
export declare function clampRating(value: number): number;
export declare function interpretKey(key: string, state: KeyState): {
    state: KeyState;
    action: KeyAction;
};
export declare function createTagFilePath(hvscPath: string, tagsPath: string, sidFile: string): string;
export declare function ensureDirectory(filePath: string): Promise<void>;
export declare function tagFileExists(tagFilePath: string): Promise<boolean>;
export declare function writeManualTag(tagFilePath: string, ratings: TagRatings, timestamp: Date): Promise<void>;
export declare function findUntaggedSids(hvscPath: string, tagsPath: string): Promise<string[]>;
export declare function shuffleInPlace(values: string[], random?: () => number): void;
//# sourceMappingURL=index.d.ts.map