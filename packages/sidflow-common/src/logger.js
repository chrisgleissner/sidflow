const LEVEL_WEIGHT = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};
function parseBooleanEnv(value) {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
}
function resolveLogLevel() {
    if (typeof process !== "undefined" && (process === null || process === void 0 ? void 0 : process.env)) {
        const env = process.env;
        if (parseBooleanEnv(env.SIDFLOW_DEBUG_LOGS) || parseBooleanEnv(env.SIDFLOW_DEBUG)) {
            return "debug";
        }
        const configured = env.SIDFLOW_LOG_LEVEL === null || env.SIDFLOW_LOG_LEVEL === void 0 ? void 0 : env.SIDFLOW_LOG_LEVEL.trim().toLowerCase();
        if (configured) {
            if (configured === "trace" || configured === "verbose") {
                return "debug";
            }
            if (Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, configured)) {
                return configured;
            }
        }
    }
    return "info";
}
const LOG_LEVEL_THRESHOLD = resolveLogLevel();
function shouldLog(level) {
    return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[LOG_LEVEL_THRESHOLD];
}
export function createLogger(namespace) {
    const prefix = `[${namespace}]`;
    const wrap = (method, level) => {
        return (message, ...args) => {
            if (!shouldLog(level)) {
                return;
            }
            method(`${prefix} ${message}`, ...args);
        };
    };
    return {
        debug: wrap(console.debug, "debug"),
        info: wrap(console.info, "info"),
        warn: wrap(console.warn, "warn"),
        error: wrap(console.error, "error"),
    };
}
//# sourceMappingURL=logger.js.map