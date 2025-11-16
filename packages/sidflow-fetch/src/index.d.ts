import { type SidflowConfig } from "@sidflow/common";
export interface FetchBootstrapOptions {
    configPath?: string;
}
export interface FetchBootstrapContext {
    config: SidflowConfig;
    sidPath: string;
    wavCachePath: string;
    tagsPath: string;
}
export declare function createFetchBootstrap(options?: FetchBootstrapOptions): Promise<FetchBootstrapContext>;
//# sourceMappingURL=index.d.ts.map