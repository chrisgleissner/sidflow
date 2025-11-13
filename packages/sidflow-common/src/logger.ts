type LogMethod = (message: string, ...args: unknown[]) => void;

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function resolveLogLevel(): LogLevel {
  if (typeof process !== 'undefined' && process?.env) {
    const env = process.env;

    if (parseBooleanEnv(env.SIDFLOW_DEBUG_LOGS) || parseBooleanEnv(env.SIDFLOW_DEBUG)) {
      return 'debug';
    }

    const configured = env.SIDFLOW_LOG_LEVEL?.trim().toLowerCase();
    if (configured) {
      if (configured === 'trace' || configured === 'verbose') {
        return 'debug';
      }
      if (configured in LEVEL_WEIGHT) {
        return configured as LogLevel;
      }
    }
  }

  return 'info';
}

const LOG_LEVEL_THRESHOLD = resolveLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[LOG_LEVEL_THRESHOLD];
}

export interface SidflowLogger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

export function createLogger(namespace: string): SidflowLogger {
  const prefix = `[${namespace}]`;

  const wrap = (method: LogMethod, level: LogLevel): LogMethod => {
    return (message: string, ...args: unknown[]) => {
      if (!shouldLog(level)) {
        return;
      }
      method(`${prefix} ${message}`, ...args);
    };
  };

  return {
    debug: wrap(console.debug, 'debug'),
    info: wrap(console.info, 'info'),
    warn: wrap(console.warn, 'warn'),
    error: wrap(console.error, 'error'),
  };
}
