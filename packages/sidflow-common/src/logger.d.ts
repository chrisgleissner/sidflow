type LogMethod = (message: string, ...args: unknown[]) => void;
export interface SidflowLogger {
    debug: LogMethod;
    info: LogMethod;
    warn: LogMethod;
    error: LogMethod;
}
export declare function createLogger(namespace: string): SidflowLogger;
export {};
//# sourceMappingURL=logger.d.ts.map