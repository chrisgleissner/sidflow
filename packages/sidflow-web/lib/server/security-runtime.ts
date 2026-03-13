const DEFAULT_ADMIN_PASSWORD = 'password';
const DEFAULT_JWT_SECRET = 'sidflow-dev-secret-change-in-production';

const warnedFlags = new Set<string>();

export interface SecurityValidationIssue {
  envVar: string;
  message: string;
}

export function isTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || env.SIDFLOW_TEST_SERVER_MODE != null;
}

export function isProductionSecurityMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && !isTestEnvironment(env);
}

function isTooShort(value: string | undefined, minLength: number): boolean {
  return value == null || value.trim().length < minLength;
}

function pushIssue(issues: SecurityValidationIssue[], envVar: string, message: string): void {
  issues.push({ envVar, message });
}

export function getSecurityValidationIssues(
  env: NodeJS.ProcessEnv = process.env
): SecurityValidationIssue[] {
  if (!isProductionSecurityMode(env)) {
    return [];
  }

  const issues: SecurityValidationIssue[] = [];
  const adminPassword = env.SIDFLOW_ADMIN_PASSWORD;
  const adminSecret = env.SIDFLOW_ADMIN_SECRET;
  const jwtSecret = env.JWT_SECRET;

  if (isTooShort(adminPassword, 12)) {
    pushIssue(
      issues,
      'SIDFLOW_ADMIN_PASSWORD',
      'must be set to a non-default value with at least 12 characters in production'
    );
  } else if (adminPassword === DEFAULT_ADMIN_PASSWORD) {
    pushIssue(issues, 'SIDFLOW_ADMIN_PASSWORD', 'must not use the development default value');
  }

  if (isTooShort(adminSecret, 32)) {
    pushIssue(
      issues,
      'SIDFLOW_ADMIN_SECRET',
      'must be set with at least 32 characters in production'
    );
  } else if (adminPassword && adminSecret === `sidflow-${adminPassword}`) {
    pushIssue(
      issues,
      'SIDFLOW_ADMIN_SECRET',
      'must not be derived from the admin password in production'
    );
  }

  if (isTooShort(jwtSecret, 32)) {
    pushIssue(issues, 'JWT_SECRET', 'must be set with at least 32 characters in production');
  } else if (jwtSecret === DEFAULT_JWT_SECRET) {
    pushIssue(issues, 'JWT_SECRET', 'must not use the development fallback secret');
  }

  if (env.SIDFLOW_DISABLE_ADMIN_AUTH === '1') {
    pushIssue(
      issues,
      'SIDFLOW_DISABLE_ADMIN_AUTH',
      'is not supported in production deployments'
    );
  }

  if (env.SIDFLOW_DISABLE_RATE_LIMIT === '1') {
    pushIssue(
      issues,
      'SIDFLOW_DISABLE_RATE_LIMIT',
      'is not supported in production deployments'
    );
  }

  return issues;
}

export function assertProductionSecurityConfig(env: NodeJS.ProcessEnv = process.env): void {
  const issues = getSecurityValidationIssues(env);
  if (issues.length === 0) {
    return;
  }

  const details = issues.map((issue) => `${issue.envVar} ${issue.message}`).join('; ');
  throw new Error(`Production security configuration is invalid: ${details}`);
}

export function isDevelopmentOnlyBypassEnabled(
  envVar: 'SIDFLOW_DISABLE_ADMIN_AUTH' | 'SIDFLOW_DISABLE_RATE_LIMIT',
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env[envVar] !== '1') {
    return false;
  }

  if (!isProductionSecurityMode(env)) {
    return true;
  }

  if (!warnedFlags.has(envVar)) {
    warnedFlags.add(envVar);
    console.warn(`[security] Ignoring ${envVar}=1 in production mode.`);
  }

  return false;
}

export function resetSecurityRuntimeWarnings(): void {
  warnedFlags.clear();
}
