import {
  CacheItem,
  CacheProvider,
  MultiSamlStrategy,
  PassportSamlConfig,
  Profile,
  ValidateInResponseTo,
  VerifiedCallback,
} from '@node-saml/passport-saml';
import passport from 'passport';
import { getTenantConfig } from '../secrets';

// Extend Passport types to include our specific mapped profile
declare global {
  namespace Express {
    interface User extends Profile {
      tenantId?: string;
      customRole?: string;
    }
  }
}

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user: Express.User, done) => {
  done(null, user);
});

/**
 * Just-In-Time group mapping: translate an IdP's `groups` assertion attribute
 * into an internal role. Exported so the mapping rule can be unit-tested
 * independently of the SAML strategy construction.
 */
export function mapGroupsToRole(profile: Profile): string {
  return Array.isArray(profile.groups) && profile.groups.includes('Admin')
    ? 'admin'
    : 'member';
}

/**
 * Public origin the IdP posts assertions back to. In production this must be the
 * externally reachable URL (behind the load balancer/proxy), so it is env-driven
 * and only falls back to localhost for local development.
 */
export const publicBaseUrl = (): string =>
  process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

/** The Assertion Consumer Service (callback) URL for a given tenant. */
export const samlCallbackUrl = (
  tenantId: string,
  baseUrl: string = publicBaseUrl()
): string =>
  `${baseUrl.replace(/\/+$/, '')}/api/auth/saml/${tenantId}/callback`;

// Only the route params are read, so no express Request declaration is pinned.
type RouteParams = { params: Record<string, string | string[] | undefined> };

// The tenant id becomes part of a Secrets Manager secret name, so traversal or a
// repeated :tenantId (an array under express 5) must not reach the lookup.
export const asTenantId = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value)
    ? value
    : null;

// ponytail: single process only, so replay protection breaks across replicas and a
// restart fails in-flight logins closed. Upgrade is a Redis SETEX CacheProvider.
export const createRequestCache = (
  ttlMs: number = 10 * 60 * 1000
): CacheProvider & { size: () => number } => {
  const items = new Map<string, CacheItem>();
  let lastPrune = 0;
  // An abandoned login is never looked up again, so lazy expiry alone leaks it.
  const prune = (now: number) => {
    if (now <= lastPrune + ttlMs) return;
    for (const [key, item] of items) {
      if (now - item.createdAt >= ttlMs) items.delete(key);
    }
    lastPrune = now;
  };
  const fresh = (key: string): CacheItem | null => {
    const item = items.get(key);
    if (!item) return null;
    if (Date.now() - item.createdAt >= ttlMs) {
      items.delete(key);
      return null;
    }
    return item;
  };
  return {
    async saveAsync(key: string, value: string) {
      const now = Date.now();
      prune(now);
      if (fresh(key)) return null;
      const item: CacheItem = { value, createdAt: now };
      items.set(key, item);
      return item;
    },
    async getAsync(key: string) {
      prune(Date.now());
      return fresh(key)?.value ?? null;
    },
    async removeAsync(key: string | null) {
      if (key === null) return null;
      return items.delete(key) ? key : null;
    },
    size: () => items.size,
  };
};

// Our own SAML entity ID: what the AuthnRequest is issued as, and the audience the
// assertion must be addressed to. Not the IdP's entity ID, which is config.issuer.
export const spEntityId = (): string =>
  process.env.ISSUER_URI || 'https://auth.enterpriseweb.com';

// Per-request IdP resolution, so a rotated certificate takes effect immediately.
export const getSamlOptions = (
  req: RouteParams,
  done: (err: Error | null, samlOptions?: Partial<PassportSamlConfig>) => void
): void => {
  const tenantId = asTenantId(req.params.tenantId);
  if (!tenantId) {
    done(new Error('SAML route is missing a valid tenantId'));
    return;
  }
  getTenantConfig(tenantId)
    .then((config) =>
      done(null, {
        callbackUrl: samlCallbackUrl(tenantId),
        entryPoint: config.entryPoint,
        issuer: spEntityId(),
        // Rejects an assertion issued by anyone other than this tenant's IdP.
        idpIssuer: config.issuer,
        idpCert: config.cert,
      })
    )
    .catch((error: unknown) => done(error as Error));
};

// The tenant comes from the validated route param, spread last so no IdP attribute
// can override it.
export const verifySignon = (
  req: RouteParams,
  profile: Profile | null,
  done: VerifiedCallback
): void => {
  if (!profile) {
    return done(new Error('SAML profile was empty'));
  }
  const tenantId = asTenantId(req.params.tenantId);
  if (!tenantId) {
    return done(new Error('SAML assertion arrived without a valid tenantId'));
  }

  // Perform Just-In-Time (JIT) Group Mapping here.
  // E.g. map Okta's 'groups' attribute to internal roles.
  const user: Express.User = {
    ...profile,
    tenantId,
    customRole: mapGroupsToRole(profile),
  };

  console.log(`[SAML] Successful assertion for ${profile.nameID || profile.email}`);
  return done(null, user);
};

// Single Logout verify. v5 requires it; the profile is handed back for the caller's
// session teardown rather than trusted to name a session on its own.
export const verifyLogout = (
  _req: RouteParams,
  profile: Profile | null,
  done: VerifiedCallback
): void => {
  if (!profile) {
    return done(new Error('SAML logout profile was empty'));
  }
  return done(null, { ...profile });
};

// One strategy for every tenant; getSamlOptions resolves the IdP per request.
export const samlStrategy = (
  cacheProvider: CacheProvider = createRequestCache()
): MultiSamlStrategy =>
  new MultiSamlStrategy(
    {
      name: 'saml',
      passReqToCallback: true,
      getSamlOptions,
      // Enterprise deployments need exact audience matching.
      audience: spEntityId(),
      // Rejects a replayed assertion, and an unsigned assertion inside a signed response.
      validateInResponseTo: ValidateInResponseTo.always,
      wantAssertionsSigned: true,
      cacheProvider,
    },
    verifySignon,
    verifyLogout
  );
