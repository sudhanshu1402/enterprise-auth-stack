import { describe, it, expect, vi, afterEach } from 'vitest';
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

import {
  createTenantStrategy,
  mapGroupsToRole,
  samlCallbackUrl,
  publicBaseUrl,
} from '../src/auth/saml';

describe('samlCallbackUrl (env-driven ACS URL)', () => {
  const original = process.env.PUBLIC_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = original;
  });

  it('falls back to localhost for local development', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(publicBaseUrl()).toBe('http://localhost:3000');
    expect(samlCallbackUrl('acme')).toBe(
      'http://localhost:3000/api/auth/saml/acme/callback'
    );
  });

  it('uses PUBLIC_BASE_URL when set, so real deploys post to the public origin', () => {
    process.env.PUBLIC_BASE_URL = 'https://sso.enterpriseweb.com';
    expect(samlCallbackUrl('acme')).toBe(
      'https://sso.enterpriseweb.com/api/auth/saml/acme/callback'
    );
  });

  it('does not double up the slash when the base URL has a trailing slash', () => {
    expect(samlCallbackUrl('acme', 'https://sso.example.com/')).toBe(
      'https://sso.example.com/api/auth/saml/acme/callback'
    );
  });
});

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
