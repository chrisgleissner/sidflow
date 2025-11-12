'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'sidflow_admin_session';

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const SESSION_RENEWAL_THRESHOLD_RATIO = 0.25; // renew when <25% TTL remains

type AdminRole = 'admin';

interface AdminConfig {
  username: string;
  password: string;
  secret: string;
  sessionTtlMs: number;
}

export interface AdminSessionPayload {
  v: 1;
  role: AdminRole;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionValidationResult {
  valid: boolean;
  reason?: string;
  payload?: AdminSessionPayload;
}

interface BasicAuthCredentials {
  username: string;
  password: string;
}

let cachedConfig: AdminConfig | null = null;
let cachedEnvSignature = '';

function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

function getEnvSignature(): string {
  return JSON.stringify({
    user: process.env.SIDFLOW_ADMIN_USER ?? 'admin',
    password: process.env.SIDFLOW_ADMIN_PASSWORD ?? '',
    secret: process.env.SIDFLOW_ADMIN_SECRET ?? '',
    ttl: process.env.SIDFLOW_ADMIN_SESSION_TTL_MS ?? '',
  });
}

export function resetAdminAuthConfigCache(): void {
  cachedConfig = null;
  cachedEnvSignature = '';
}

export function getAdminConfig(): AdminConfig {
  const signature = getEnvSignature();
  if (cachedConfig && signature === cachedEnvSignature) {
    return cachedConfig;
  }

  const username = process.env.SIDFLOW_ADMIN_USER ?? 'admin';
  const password = process.env.SIDFLOW_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('SIDFLOW_ADMIN_PASSWORD must be set to enable /admin authentication');
  }

  const sessionTtlEnv = process.env.SIDFLOW_ADMIN_SESSION_TTL_MS;
  const sessionTtlMs = Number.isFinite(Number(sessionTtlEnv))
    ? Math.max(5 * 60 * 1000, Number(sessionTtlEnv))
    : DEFAULT_SESSION_TTL_MS;

  const secret =
    process.env.SIDFLOW_ADMIN_SECRET && process.env.SIDFLOW_ADMIN_SECRET.length >= 16
      ? process.env.SIDFLOW_ADMIN_SECRET
      : `sidflow-${password}`;

  cachedConfig = {
    username,
    password,
    secret,
    sessionTtlMs,
  };
  cachedEnvSignature = signature;
  return cachedConfig;
}

export function parseBasicAuth(header: string | null): BasicAuthCredentials | null {
  if (!header || !header.startsWith('Basic ')) {
    return null;
  }
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      return null;
    }
    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);
    return { username, password };
  } catch {
    return null;
  }
}

export function verifyAdminCredentials(
  credentials: BasicAuthCredentials | null,
  config: AdminConfig
): boolean {
  if (!credentials) {
    return false;
  }
  return safeCompare(credentials.username, config.username) && safeCompare(credentials.password, config.password);
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function encodeSessionPayload(payload: AdminSessionPayload, secret: string): string {
  const base = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signPayload(base, secret);
  return `${base}.${signature}`;
}

export function decodeSessionToken(token: string, secret: string): SessionValidationResult {
  const [base, signature] = token.split('.');
  if (!base || !signature) {
    return { valid: false, reason: 'invalid-format' };
  }

  const expectedSignature = signPayload(base, secret);
  const signatureValid = safeCompare(signature, expectedSignature);
  if (!signatureValid) {
    return { valid: false, reason: 'invalid-signature' };
  }

  try {
    const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8')) as AdminSessionPayload;
    if (payload.v !== 1) {
      return { valid: false, reason: 'invalid-version' };
    }
    if (payload.role !== 'admin') {
      return { valid: false, reason: 'invalid-role' };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'invalid-payload' };
  }
}

export function issueSessionToken(config: AdminConfig, now = Date.now()): { token: string; payload: AdminSessionPayload } {
  const payload: AdminSessionPayload = {
    v: 1,
    role: 'admin',
    issuedAt: now,
    expiresAt: now + config.sessionTtlMs,
  };
  const token = encodeSessionPayload(payload, config.secret);
  return { token, payload };
}

export function validateSessionToken(
  token: string | undefined,
  config: AdminConfig,
  now = Date.now()
): SessionValidationResult {
  if (!token) {
    return { valid: false, reason: 'missing-token' };
  }
  const decoded = decodeSessionToken(token, config.secret);
  if (!decoded.valid || !decoded.payload) {
    return decoded;
  }
  if (decoded.payload.expiresAt <= now) {
    return { valid: false, reason: 'expired' };
  }
  return decoded;
}

export function shouldRenewSession(payload: AdminSessionPayload, config: AdminConfig, now = Date.now()): boolean {
  const ttl = config.sessionTtlMs;
  const elapsed = now - payload.issuedAt;
  if (ttl <= 0 || elapsed < 0) {
    return false;
  }
  const remaining = payload.expiresAt - now;
  return remaining <= ttl * SESSION_RENEWAL_THRESHOLD_RATIO;
}

export function buildUnauthorizedResponseBody(reason: string) {
  return {
    error: 'unauthorized',
    reason,
  } as const;
}
