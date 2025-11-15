import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  buildUnauthorizedResponseBody,
  decodeSessionToken,
  encodeSessionPayload,
  getAdminConfig,
  issueSessionToken,
  parseBasicAuth,
  resetAdminAuthConfigCache,
  shouldRenewSession,
  validateSessionToken,
  verifyAdminCredentials,
  type AdminSessionPayload,
} from '@/lib/server/admin-auth-core';

const AUTH_HEADER_PREFIX = 'Basic ';

function buildBasicAuth(username: string, password: string): string {
  return `${AUTH_HEADER_PREFIX}${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

beforeEach(() => {
  process.env.SIDFLOW_ADMIN_USER = 'ops';
  process.env.SIDFLOW_ADMIN_PASSWORD = 'test-pass-123';
  process.env.SIDFLOW_ADMIN_SECRET = 'sidflow-test-secret-456789';
  process.env.SIDFLOW_ADMIN_SESSION_TTL_MS = '60000';
  resetAdminAuthConfigCache();
});

afterEach(() => {
  delete process.env.SIDFLOW_ADMIN_USER;
  delete process.env.SIDFLOW_ADMIN_PASSWORD;
  delete process.env.SIDFLOW_ADMIN_SECRET;
  delete process.env.SIDFLOW_ADMIN_SESSION_TTL_MS;
  resetAdminAuthConfigCache();
});

describe('admin auth', () => {
  it('rejects unauthorized credentials', () => {
    const config = getAdminConfig();
    const credentials = parseBasicAuth(buildBasicAuth('ops', 'wrong-pass'));
    expect(verifyAdminCredentials(credentials, config)).toBe(false);
  });

  it('blocks role escalation attempts via tampered session tokens', async () => {
    const config = getAdminConfig();
    const tamperedPayload = {
      v: 1,
      role: 'superadmin',
      issuedAt: 0,
      expiresAt: config.sessionTtlMs,
    } as unknown as AdminSessionPayload;

    const token = await encodeSessionPayload(tamperedPayload, config.secret);
    const validation = await validateSessionToken(token, config, Date.now());

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('invalid-role');
  });

  it('expires sessions when past the configured TTL', async () => {
    const config = getAdminConfig();
    const { token, payload } = await issueSessionToken(config, 0);
    const validation = await validateSessionToken(token, config, payload.expiresAt + 1);

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('expired');
  });

  it('generates config defaults and memoizes across calls', () => {
    delete process.env.SIDFLOW_ADMIN_SECRET;
    resetAdminAuthConfigCache();

    const first = getAdminConfig();
    expect(first.secret).toBe(`sidflow-${process.env.SIDFLOW_ADMIN_PASSWORD}`);
    expect(getAdminConfig()).toBe(first);

    process.env.SIDFLOW_ADMIN_SECRET = 'sidflow-another-secret-7890';
    resetAdminAuthConfigCache();
    const updated = getAdminConfig();
    expect(updated.secret).toBe('sidflow-another-secret-7890');
  });

  it('defaults to insecure password when admin password is not configured (dev only)', () => {
    // Clear both password and secret to validate fallback behaviors
    delete process.env.SIDFLOW_ADMIN_PASSWORD;
    delete process.env.SIDFLOW_ADMIN_SECRET;
    resetAdminAuthConfigCache();
    const config = getAdminConfig();
    expect(config.password).toBe('password');
    // Secret should derive from the fallback password when explicit secret is absent
    expect(config.secret).toBe('sidflow-password');
  });

  it('parses valid credentials and rejects malformed headers', () => {
    const header = buildBasicAuth('ops', 'test-pass-123');
    const parsed = parseBasicAuth(header);
    expect(parsed).toEqual({ username: 'ops', password: 'test-pass-123' });

    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth('Bearer token')).toBeNull();
    expect(parseBasicAuth(`${AUTH_HEADER_PREFIX}invalid-base64`)).toBeNull();
    expect(parseBasicAuth(`${AUTH_HEADER_PREFIX}${Buffer.from('nocolon', 'utf8').toString('base64')}`)).toBeNull();
  });

  it('round-trips and validates session payloads', async () => {
    const config = getAdminConfig();
    const now = Date.now();
    const payload: AdminSessionPayload = {
      v: 1,
      role: 'admin',
      issuedAt: now,
      expiresAt: now + config.sessionTtlMs,
    };
    const token = await encodeSessionPayload(payload, config.secret);
    const decoded = await decodeSessionToken(token, config.secret);

    expect(decoded.valid).toBe(true);
    expect(decoded.payload).toEqual(payload);

    const tampered = `${token.split('.')[0]}.bogus-signature`;
    const invalid = await decodeSessionToken(tampered, config.secret);
    expect(invalid.valid).toBe(false);
    expect(invalid.reason).toBe('invalid-signature');
  });

  it('identifies sessions that require renewal', async () => {
    const config = getAdminConfig();
    const { payload } = await issueSessionToken(config, 0);

    const nearExpiryTime = payload.expiresAt - config.sessionTtlMs * 0.2;
    const nearExpiry = shouldRenewSession(payload, config, nearExpiryTime);
    expect(nearExpiry).toBe(true);

    const earlyTime = payload.issuedAt + config.sessionTtlMs * 0.1;
    const early = shouldRenewSession(payload, config, earlyTime);
    expect(early).toBe(false);
  });

  it('validates missing tokens and builds unauthorized responses', async () => {
    const config = getAdminConfig();
    const validation = await validateSessionToken(undefined, config);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('missing-token');

    const body = buildUnauthorizedResponseBody('missing-token');
    expect(body).toEqual({ error: 'unauthorized', reason: 'missing-token' });
  });
});
