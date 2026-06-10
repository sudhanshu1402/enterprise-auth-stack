import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { issueInternalToken } from '../src/auth/jwt';

// jwt.ts falls back to this dev secret when JWT_SECRET_DEV_ONLY is unset.
const SECRET = 'super-secret-enterprise-key-do-not-use';
const decode = (token: string) =>
  jwt.verify(token, SECRET, { audience: 'internal-api-gateway' }) as Record<string, unknown>;

describe('issueInternalToken', () => {
  it('maps a fully-populated user into the internal claims', () => {
    const token = issueInternalToken({ nameID: 'user-1', email: 'a@b.com', tenantId: 't1', customRole: 'admin' } as any);
    const c = decode(token);
    expect(c.sub).toBe('user-1');
    expect(c.email).toBe('a@b.com');
    expect(c.tenantId).toBe('t1');
    expect(c.role).toBe('admin');
    expect(c.aud).toBe('internal-api-gateway');
  });

  it('applies safe defaults when fields are missing', () => {
    const c = decode(issueInternalToken({} as any));
    expect(c.sub).toBe('unknown');
    expect(c.email).toBe('');
    expect(c.tenantId).toBe('');
    expect(c.role).toBe('member');
  });

  it('falls back to email for the subject when nameID is absent', () => {
    const c = decode(issueInternalToken({ email: 'x@y.com' } as any));
    expect(c.sub).toBe('x@y.com');
  });
});
