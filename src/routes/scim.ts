import { Router, Request, Response, NextFunction } from 'express';

export const scimRouter = Router();

// SCIM Authentication Middleware
const requireScimToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const expectedToken = `Bearer ${process.env.SCIM_BEARER_TOKEN || 'test_scim_token_here'}`;

  if (!authHeader || authHeader !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized SCIM Request' });
  }
  next();
};

scimRouter.use(requireScimToken);

/**
 * SCIM 2.0 User Provisioning Endpoint (Mock Interface)
 * Called automatically by Okta / Azure AD when an admin assigns a user to the app.
 */
scimRouter.post('/Users', (req: Request, res: Response) => {
  console.log('[SCIM] Received User Provisioning Request');
  
  const { userName, name, active } = req.body;
  
  // Logic to synchronously mirror the directory state to our DB would occur here.
  // This achieves Zero Manual Configuration for new clients.

  res.status(201).json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: "mock_uuid_12345",
    userName,
    name,
    active
  });
});

/**
 * SCIM 2.0 User Deprovisioning Endpoint
 */
scimRouter.delete('/Users/:id', (req: Request, res: Response) => {
  console.log(`[SCIM] Deprovisioning User: ${req.params.id}`);
  
  // Logic to lock the account internally happens here.
  // In v2, this would also fire an event to Redis to invalidate active JWTs instantly.

  res.status(204).send();
});
