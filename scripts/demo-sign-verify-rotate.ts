import jwt from 'jsonwebtoken';
import { issueInternalToken } from '../src/auth/jwt';
import { mapGroupsToRole } from '../src/auth/saml';

// Fixed clock so exp/iat are identical on every run, not "now".
function withFixedClock<T>(ms: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

const profile = { nameID: 'okta|demo-user', email: 'demo@enterprise.example', groups: ['Admin'] } as any;
const role = mapGroupsToRole(profile);
const user = { ...profile, tenantId: 'tenant-acme', customRole: role };

withFixedClock(1700000000000, () => {
  process.env.JWT_SECRET_DEV_ONLY = 'demo-secret-v1';
  const tokenV1 = issueInternalToken(user);
  console.log(`sign   tenant-acme ${role} -> token issued, exp 3600s`);

  const decoded1 = jwt.verify(tokenV1, 'demo-secret-v1') as Record<string, unknown>;
  console.log(`verify token ok  sub=${decoded1.sub} role=${decoded1.role} tenantId=${decoded1.tenantId}`);

  console.log('rotate JWT_SECRET_DEV_ONLY -> new value');
  process.env.JWT_SECRET_DEV_ONLY = 'demo-secret-v2';

  try {
    jwt.verify(tokenV1, 'demo-secret-v2');
    console.log('verify old token against rotated secret: unexpectedly passed');
  } catch {
    console.log('verify old token against rotated secret: FAILED (signature invalid)');
  }

  const tokenV2 = issueInternalToken(user);
  console.log(`sign   tenant-acme ${role} -> token issued under rotated secret`);

  const decoded2 = jwt.verify(tokenV2, 'demo-secret-v2') as Record<string, unknown>;
  console.log(`verify new token ok  sub=${decoded2.sub} role=${decoded2.role} tenantId=${decoded2.tenantId}`);
});
