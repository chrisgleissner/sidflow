let loggingConfigured = false;

function envFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isDebugEnabled(): boolean {
  const env = typeof process !== 'undefined' ? process.env ?? {} : {} as NodeJS.ProcessEnv;
  const level = env.SIDFLOW_LOG_LEVEL?.trim().toLowerCase();
  if (level === 'debug' || level === 'trace' || level === 'verbose') {
    return true;
  }
  if (envFlag(env.SIDFLOW_DEBUG_LOGS) || envFlag(env.SIDFLOW_DEBUG)) {
    return true;
  }
  return false;
}

export function configureE2eLogging(): void {
  if (loggingConfigured) {
    return;
  }
  loggingConfigured = true;

  if (isDebugEnabled()) {
    return;
  }

  const noop = () => undefined;
  console.debug = noop;
}
