export function createLogger(namespace) {
    const prefix = `[${namespace}]`;
    const wrap = (method) => {
        return (message, ...args) => {
            method(`${prefix} ${message}`, ...args);
        };
    };
    return {
        debug: wrap(console.debug),
        info: wrap(console.info),
        warn: wrap(console.warn),
        error: wrap(console.error)
    };
}
//# sourceMappingURL=logger.js.map