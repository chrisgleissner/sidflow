import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  encodeSessionPayload,
  getAdminConfig,
  issueSessionToken,
  parseBasicAuth,
  resetAdminAuthConfigCache,
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
});
