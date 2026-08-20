import jwt from 'jsonwebtoken';

// In production, this would also rely on AWS Secrets Manager / KMS to fetch the private signing key.
//
// Fails closed in production: if JWT_SECRET_DEV_ONLY is unset we refuse to sign
// with the built-in dev key (which is visible in source), rather than issuing a
// token anyone reading the repo could forge.
const signingSecret = (): string => {
  const configured = process.env.JWT_SECRET_DEV_ONLY;
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT signing secret is not configured');
    }
    return 'super-secret-enterprise-key-do-not-use';
  }
  return configured;
};

export interface InternalJwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
}

/**
 * Issues an internal standard JWT.
 * This abstracts away the complexity of the upstream IdP (SAML vs OIDC)
 * and issues a uniform token for internal microservice consumption.
 */
export const issueInternalToken = (user: Express.User): string => {
  const payload: InternalJwtPayload = {
    sub: user.nameID || user.email || 'unknown',
    email: typeof user.email === 'string' ? user.email : '',
    tenantId: user.tenantId || '',
    role: user.customRole || 'member'
  };

  // Only set `issuer` when configured — jsonwebtoken rejects an undefined
  // issuer, which would otherwise crash token issuance when ISSUER_URI is unset.
  const signOptions: jwt.SignOptions = { expiresIn: '1h', audience: 'internal-api-gateway' };
  if (process.env.ISSUER_URI) signOptions.issuer = process.env.ISSUER_URI;

  return jwt.sign(payload, signingSecret(), signOptions);
};
