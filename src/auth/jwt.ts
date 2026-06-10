import jwt from 'jsonwebtoken';

// In production, this would also rely on AWS Secrets Manager / KMS to fetch the private signing key
const JWT_SECRET = process.env.JWT_SECRET_DEV_ONLY || 'super-secret-enterprise-key-do-not-use';

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

  return jwt.sign(payload, JWT_SECRET, signOptions);
};
