import express, { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import { asTenantId, samlStrategy } from './auth/saml';
import { issueInternalToken } from './auth/jwt';
import { scimRouter } from './routes/scim';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './swagger';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Needed for SAML POST bindings
app.use(passport.initialize());

// One strategy for every tenant. Registering it once, instead of building one per
// request, is what lets the InResponseTo replay cache survive from the redirect to
// the IdP until the assertion posts back.
passport.use('saml', samlStrategy());

// Mount Swagger OpenAPI Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// --- 1) SCIM PROVISIONING ENDPOINTS ---
app.use('/scim/v2', scimRouter);

// --- SAML Single Sign-On Layer ---

// Reject a malformed tenant slug with 400 before the strategy turns it into a
// Secrets Manager lookup failure, which would surface as a 500.
const requireTenantId = (req: Request, res: Response, next: NextFunction) => {
  if (!asTenantId(req.params.tenantId)) {
    res.status(400).json({ error: 'tenantId must be a slug of letters, digits and dashes.' });
    return;
  }
  next();
};

// Dynamic route to initiate IdP SSO. The tenant is read off :tenantId by
// getSamlOptions, so the same registered strategy serves every tenant.
app.get('/api/auth/saml/:tenantId/login', requireTenantId, (req, res, next) => {
  passport.authenticate('saml', { session: false })(req, res, next);
});

// Dynamic IdP Assertion Consumer Service (Callback)
app.post(
  '/api/auth/saml/:tenantId/callback',
  requireTenantId,
  (req, res, next) => {
    passport.authenticate('saml', { session: false }, (err: any, user: Express.User) => {
      if (err || !user) {
        return res.status(401).json({ error: 'SAML Assertion Failed' });
      }

      // 1. User is asserted valid by the downstream Enterprise IdP
      // 2. Issue internal decoupled token mapping JIT assigned roles
      const internalJwt = issueInternalToken(user);

      res.status(200).json({
        message: 'Authentication Successful',
        token: internalJwt,
        role: user.customRole
      });
    })(req, res, next);
  }
);

// Express's default handler renders HTML and leaks a stack trace outside production.
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[SSO] unhandled error', error);
  res.status(500).json({ error: 'SSO configuration failed for tenant.' });
});

app.listen(port, () => {
  console.log(`🚀 Enterprise Auth Server running on port ${port}`);
});
