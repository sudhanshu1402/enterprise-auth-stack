import { describe, it, expect, vi, afterEach } from 'vitest';
import { MultiSamlStrategy } from '@node-saml/passport-saml';

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
  asTenantId,
  createRequestCache,
  getSamlOptions,
  mapGroupsToRole,
  samlCallbackUrl,
  samlStrategy,
  publicBaseUrl,
  verifyLogout,
  verifySignon,
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

describe('asTenantId', () => {
  it('accepts a normal tenant slug', () => {
    expect(asTenantId('acme')).toBe('acme');
    expect(asTenantId('acme-corp-2')).toBe('acme-corp-2');
  });

  // The value lands in a Secrets Manager secret name, so traversal or a repeated
  // :tenantId (which express 5 hands over as an array) must not get through.
  it('rejects traversal, wildcards, empty and non-string values', () => {
    for (const bad of ['../other', 'a/b', '*', '', '-lead', 'x'.repeat(65), ['acme'], 0, null, undefined, {}]) {
      expect(asTenantId(bad)).toBeNull();
    }
  });
});

describe('getSamlOptions (per-request IdP resolution)', () => {
  it('resolves the tenant config into strategy options', async () => {
    const options = await new Promise<any>((resolve, reject) =>
      getSamlOptions({ params: { tenantId: 'acme' } }, (err, opts) =>
        err ? reject(err) : resolve(opts)
      )
    );
    expect(options).toMatchObject({
      entryPoint: 'https://idp.example.com/sso',
      // issuer is our own entity id; the IdP's goes to idpIssuer so the response
      // Issuer is validated instead of ignored.
      issuer: 'https://auth.enterpriseweb.com',
      idpIssuer: 'https://idp.example.com',
      idpCert: 'TEST_CERT',
      callbackUrl: 'http://localhost:3000/api/auth/saml/acme/callback',
    });
  });

  it('errors instead of querying secrets when the tenant id is invalid', async () => {
    const err = await new Promise<Error | null>((resolve) =>
      getSamlOptions({ params: { tenantId: '../other' } }, (e) => resolve(e))
    );
    expect(err?.message).toContain('tenantId');
  });
});

// The strategy is registered once and builds a SAML provider per request, so the
// replay cache has to be the shared one or ValidateInResponseTo.always rejects
// every assertion. Assert the provider survives on the constructed strategy.
describe('samlStrategy', () => {
  it('registers a single multi-tenant strategy holding the shared cache', () => {
    const cacheProvider = createRequestCache();
    const strategy = samlStrategy(cacheProvider);
    expect(strategy).toBeInstanceOf(MultiSamlStrategy);
    expect(strategy.name).toBe('saml');
    expect((strategy as any)._options.cacheProvider).toBe(cacheProvider);
  });
});

describe('verifySignon (assembles the user the JWT is minted from)', () => {
  const run = (req: any, profile: any) =>
    new Promise<{ err: Error | null; user?: any }>((resolve) =>
      verifySignon(req, profile, (err, user) => resolve({ err, user }))
    );

  it('binds the route tenant and the mapped role onto the profile', async () => {
    const { err, user } = await run(
      { params: { tenantId: 'acme' } },
      { nameID: 'jo@acme.test', groups: ['Admin'] }
    );
    expect(err).toBeNull();
    expect(user).toMatchObject({
      nameID: 'jo@acme.test',
      tenantId: 'acme',
      customRole: 'admin',
    });
  });

  it('does not let an IdP attribute override the tenant from the route', async () => {
    const { user } = await run(
      { params: { tenantId: 'acme' } },
      { nameID: 'jo@acme.test', tenantId: 'other-tenant', customRole: 'admin', groups: [] }
    );
    expect(user.tenantId).toBe('acme');
    expect(user.customRole).toBe('member');
  });

  it('fails closed on an empty profile or an invalid tenant', async () => {
    expect((await run({ params: { tenantId: 'acme' } }, null)).err?.message).toContain(
      'profile was empty'
    );
    expect(
      (await run({ params: { tenantId: '../other' } }, { nameID: 'x' })).err?.message
    ).toContain('tenantId');
  });
});

describe('verifyLogout', () => {
  it('hands the profile back, and errors when there is none', async () => {
    const ok = await new Promise<any>((resolve) =>
      verifyLogout({ params: {} }, { nameID: 'jo@acme.test' } as any, (_e, u) => resolve(u))
    );
    expect(ok).toEqual({ nameID: 'jo@acme.test' });
    const err = await new Promise<Error | null>((resolve) =>
      verifyLogout({ params: {} }, null, (e) => resolve(e))
    );
    expect(err?.message).toContain('logout profile was empty');
  });
});

describe('createRequestCache', () => {
  it('stores a request id, returns it once, and refuses to overwrite a live key', async () => {
    const cache = createRequestCache();
    expect(await cache.saveAsync('id-1', 'instant')).toMatchObject({ value: 'instant' });
    expect(await cache.saveAsync('id-1', 'other')).toBeNull();
    expect(await cache.getAsync('id-1')).toBe('instant');
    expect(await cache.removeAsync('id-1')).toBe('id-1');
    expect(await cache.getAsync('id-1')).toBeNull();
    expect(await cache.removeAsync(null)).toBeNull();
  });

  it('expires a key past its ttl, so a stale InResponseTo cannot be replayed', async () => {
    const cache = createRequestCache(0);
    await cache.saveAsync('id-2', 'instant');
    expect(await cache.getAsync('id-2')).toBeNull();
  });

  // An abandoned login writes an entry nothing ever reads back, so lazy expiry on
  // its own would grow the Map for the life of the process.
  it('sweeps abandoned entries instead of waiting to be asked for them', async () => {
    vi.useFakeTimers();
    try {
      const cache = createRequestCache(60_000);
      for (let i = 0; i < 50; i += 1) await cache.saveAsync(`abandoned-${i}`, 'instant');
      expect(cache.size()).toBe(50);
      vi.setSystemTime(Date.now() + 120_000);
      await cache.saveAsync('later', 'instant');
      expect(cache.size()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps live entries while sweeping', async () => {
    const cache = createRequestCache();
    await cache.saveAsync('id-3', 'instant');
    await cache.saveAsync('id-4', 'instant');
    expect(cache.size()).toBe(2);
    expect(await cache.getAsync('id-3')).toBe('instant');
  });
});
