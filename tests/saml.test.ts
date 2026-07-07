import { describe, it, expect, vi } from 'vitest';
import { Strategy as SamlStrategy } from 'passport-saml';

// Stub the Secrets Manager lookup so createTenantStrategy builds from a
// deterministic config instead of reaching AWS.
vi.mock('../src/secrets', () => ({
  getTenantConfig: vi.fn(async () => ({
    entryPoint: 'https://idp.example.com/sso',
    issuer: 'https://idp.example.com',
    cert: 'TEST_CERT',
  })),
}));

import { createTenantStrategy, mapGroupsToRole } from '../src/auth/saml';

describe('mapGroupsToRole', () => {
  it('maps an Admin group assertion to the admin role', () => {
    expect(mapGroupsToRole({ groups: ['Users', 'Admin'] } as any)).toBe('admin');
  });

  it('defaults to member when the Admin group is absent', () => {
    expect(mapGroupsToRole({ groups: ['Users', 'Billing'] } as any)).toBe('member');
  });

  it('defaults to member when groups is missing or not an array', () => {
    expect(mapGroupsToRole({} as any)).toBe('member');
    expect(mapGroupsToRole({ groups: 'Admin' } as any)).toBe('member');
  });
});

describe('createTenantStrategy', () => {
  it('builds a passport-saml strategy from the resolved tenant config', async () => {
    const strategy = await createTenantStrategy('acme');
    expect(strategy).toBeInstanceOf(SamlStrategy);
    expect((strategy as any).name).toBe('saml');
  });
});
