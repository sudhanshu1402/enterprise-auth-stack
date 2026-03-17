import express from 'express';
import passport from 'passport';
import { createTenantStrategy } from './auth/saml';
import { issueInternalToken } from './auth/jwt';
import { scimRouter } from './routes/scim';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Needed for SAML POST bindings
app.use(passport.initialize());

// --- SCIM Directory Provisioning Layer ---
app.use('/scim/v2', scimRouter);

// --- SAML Single Sign-On Layer ---

// Dynamic route to initiate IdP SSO
app.get('/api/auth/saml/:tenantId/login', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const strategy = await createTenantStrategy(tenantId);
    
    // Passport strategy injection at runtime
    passport.authenticate(strategy, { session: false })(req, res, next);
  } catch (error) {
    res.status(500).json({ error: 'SSO Configuration failed for tenant.' });
  }
});

// Dynamic IdP Assertion Consumer Service (Callback)
app.post(
  '/api/auth/saml/:tenantId/callback',
  async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const strategy = await createTenantStrategy(tenantId);
      
      passport.authenticate(strategy, { session: false }, (err: any, user: Express.User) => {
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
    } catch (error) {
      res.status(500).json({ error: 'Assertion processing failed.' });
    }
  }
);

app.listen(port, () => {
  console.log(`🚀 Enterprise Auth Server running on port ${port}`);
});
