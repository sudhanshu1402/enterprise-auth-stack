import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// The module under test reads its signing secret from process.env at import time.
// We set a known secret BEFORE importing so we can independently verify signatures
// with the same key. A dynamic import is used so the env var is in place first.
const TEST_SECRET = 'test-only-deterministic-secret-1234567890';

let issueInternalToken: typeof import('../src/auth/jwt').issueInternalToken;

beforeAll(async () => {
  process.env.JWT_SECRET_DEV_ONLY = TEST_SECRET;
  delete process.env.ISSUER_URI;
  const mod = await import('../src/auth/jwt');
  issueInternalToken = mod.issueInternalToken;
});

afterAll(() => {
  delete process.env.JWT_SECRET_DEV_ONLY;
  delete process.env.ISSUER_URI;
});

// Minimal stand-in for the SAML-mapped Express.User shape consumed by the issuer.
const baseUser = {
  nameID: 'okta|abc-123',
  email: 'alice@enterprise.example',
  tenantId: 'tenant-acme',
  customRole: 'admin'
} as unknown as Express.User;

describe('issueInternalToken', () => {
  it('mints a token whose claims verify with the configured secret', () => {
    const token = issueInternalToken(baseUser);
    const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;

    expect(decoded.sub).toBe('okta|abc-123');
    expect(decoded.email).toBe('alice@enterprise.example');
    expect(decoded.tenantId).toBe('tenant-acme');
    expect(decoded.role).toBe('admin');
    expect(decoded.aud).toBe('internal-api-gateway');
    // exp must be set roughly one hour out (expiresIn: 1h).
    expect(typeof decoded.exp).toBe('number');
    expect(typeof decoded.iat).toBe('number');
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(3600);
  });

  it('falls back to email for sub when nameID is absent', () => {
    const user = { email: 'bob@enterprise.example', tenantId: 't2', customRole: 'member' } as unknown as Express.User;
    const decoded = jwt.verify(issueInternalToken(user), TEST_SECRET) as Record<string, unknown>;
    expect(decoded.sub).toBe('bob@enterprise.example');
  });

  it('falls back to the literal unknown sub and empty email when neither nameID nor email exist', () => {
    const user = { tenantId: 't3' } as unknown as Express.User;
    const decoded = jwt.verify(issueInternalToken(user), TEST_SECRET) as Record<string, unknown>;
    expect(decoded.sub).toBe('unknown');
    expect(decoded.email).toBe('');
  });

  it('defaults role to member and tenantId to empty string when not supplied', () => {
    const user = { nameID: 'id-only' } as unknown as Express.User;
    const decoded = jwt.verify(issueInternalToken(user), TEST_SECRET) as Record<string, unknown>;
    expect(decoded.role).toBe('member');
    expect(decoded.tenantId).toBe('');
  });

  it('coerces a non-string email to an empty string claim', () => {
    const user = { nameID: 'id-x', email: 12345 } as unknown as Express.User;
    const decoded = jwt.verify(issueInternalToken(user), TEST_SECRET) as Record<string, unknown>;
    // sub still resolves from nameID; email is not a string so it is blanked.
    expect(decoded.sub).toBe('id-x');
    expect(decoded.email).toBe('');
  });

  it('rejects verification when the token signature is tampered with', () => {
    const token = issueInternalToken(baseUser);
    const parts = token.split('.');
    // Flip the last character of the signature segment to corrupt it.
    const sig = parts[2];
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`;
    expect(() => jwt.verify(tampered, TEST_SECRET)).toThrow();
  });

  it('rejects verification when a different secret is used', () => {
    const token = issueInternalToken(baseUser);
    expect(() => jwt.verify(token, 'a-completely-different-secret')).toThrow();
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const token = issueInternalToken(baseUser);
      // Advance time beyond the 1h expiry plus a small clock-skew margin.
      vi.advanceTimersByTime(3600 * 1000 + 60 * 1000);
      expect(() => jwt.verify(token, TEST_SECRET)).toThrow(/jwt expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects verification when the expected audience does not match', () => {
    const token = issueInternalToken(baseUser);
    expect(() => jwt.verify(token, TEST_SECRET, { audience: 'some-other-audience' })).toThrow();
    // Sanity check: the correct audience still verifies.
    expect(() => jwt.verify(token, TEST_SECRET, { audience: 'internal-api-gateway' })).not.toThrow();
  });
});
