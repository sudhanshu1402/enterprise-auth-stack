import { Strategy as SamlStrategy, Profile } from 'passport-saml';
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
 * Factory for creating tenant-specific SAML strategies dynamically.
 * Enterprise B2B requires isolated IdP configurations per client.
 */
export const createTenantStrategy = async (tenantId: string) => {
  const config = await getTenantConfig(tenantId);

  return new SamlStrategy(
    {
      callbackUrl: `http://localhost:3000/api/auth/saml/${tenantId}/callback`,
      entryPoint: config.entryPoint,
      issuer: config.issuer,
      cert: config.cert,
      // For enterprise deployments, exact audience matching is strictly required
      audience: process.env.ISSUER_URI || 'https://auth.enterpriseweb.com',
    },
    (profile: Profile | null | undefined, done: (err: Error | null, user?: any) => void) => {
      if (!profile) {
        return done(new Error('SAML profile was empty'));
      }
      
      // Perform Just-In-Time (JIT) Group Mapping here.
      // E.g. map Okta's 'groups' attribute to internal roles.
      const mappedRole = Array.isArray(profile.groups) && profile.groups.includes('Admin') 
        ? 'admin' 
        : 'member';

      const user: Express.User = {
        ...profile,
        tenantId,
        customRole: mappedRole
      };

      console.log(`[SAML] Successful assertion for ${profile.nameID || profile.email}`);
      return done(null, user);
    }
  );
};
