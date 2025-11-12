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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

let cachedConfig: AdminConfig | null = null;
let cachedEnvSignature = '';

function ensureSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto API is not available in this environment');
  }
  return subtle;
}

function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function toBinaryString(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += String.fromCharCode(bytes[i]);
  }
  return output;
}

function fromBinaryString(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(toBinaryString(bytes));
  }
  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(bytes).toString('base64');
  }
  throw new Error('Base64 encoding not supported in this environment');
}

function base64Decode(base64: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    return fromBinaryString(globalThis.atob(base64));
  }
  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(base64, 'base64'));
  }
  throw new Error('Base64 decoding not supported in this environment');
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return base64Decode(base64);
}

function decodeBase64String(value: string): string {
  return decodeUtf8(base64Decode(value));
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getEnvSignature(): string {
  return JSON.stringify({
    user: process.env.SIDFLOW_ADMIN_USER ?? 'admin',
    password: process.env.SIDFLOW_ADMIN_PASSWORD ?? '',
    secret: process.env.SIDFLOW_ADMIN_SECRET ?? '',
    ttl: process.env.SIDFLOW_ADMIN_SESSION_TTL_MS ?? '',
  });
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  let cached = hmacKeyCache.get(secret);
  if (!cached) {
    const subtle = ensureSubtleCrypto();
    cached = subtle
      .importKey('raw', encodeUtf8(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .catch((error) => {
        hmacKeyCache.delete(secret);
        throw error;
      });
    hmacKeyCache.set(secret, cached);
  }
  return cached;
}

async function signPayload(payloadB64: string, secret: string): Promise<string> {
  const key = await getHmacKey(secret);
  const subtle = ensureSubtleCrypto();
  const signature = await subtle.sign('HMAC', key, encodeUtf8(payloadB64) as BufferSource);
  return base64UrlEncode(new Uint8Array(signature));
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
    const decoded = decodeBase64String(header.slice(6));
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

export async function encodeSessionPayload(payload: AdminSessionPayload, secret: string): Promise<string> {
  const base = base64UrlEncode(encodeUtf8(JSON.stringify(payload)));
  const signature = await signPayload(base, secret);
  return `${base}.${signature}`;
}

export async function decodeSessionToken(
  token: string,
  secret: string
): Promise<SessionValidationResult> {
  const [base, signature] = token.split('.');
  if (!base || !signature) {
    return { valid: false, reason: 'invalid-format' };
  }

  const expectedSignature = await signPayload(base, secret);
  if (!safeCompare(signature, expectedSignature)) {
    return { valid: false, reason: 'invalid-signature' };
  }

  try {
    const payload = JSON.parse(decodeUtf8(base64UrlDecode(base))) as AdminSessionPayload;
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

export async function issueSessionToken(
  config: AdminConfig,
  now = Date.now()
): Promise<{ token: string; payload: AdminSessionPayload }> {
  const payload: AdminSessionPayload = {
    v: 1,
    role: 'admin',
    issuedAt: now,
    expiresAt: now + config.sessionTtlMs,
  };
  const token = await encodeSessionPayload(payload, config.secret);
  return { token, payload };
}

export async function validateSessionToken(
  token: string | undefined,
  config: AdminConfig,
  now = Date.now()
): Promise<SessionValidationResult> {
  if (!token) {
    return { valid: false, reason: 'missing-token' };
  }
  const decoded = await decodeSessionToken(token, config.secret);
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

