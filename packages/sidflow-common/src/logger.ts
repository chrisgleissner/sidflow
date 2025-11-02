type LogMethod = (message: string, ...args: unknown[]) => void;

export interface SidflowLogger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

export function createLogger(namespace: string): SidflowLogger {
  const prefix = `[${namespace}]`;

  const wrap = (method: LogMethod): LogMethod => {
    return (message: string, ...args: unknown[]) => {
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
