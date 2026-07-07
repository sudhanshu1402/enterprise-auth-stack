export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Enterprise Authentication Stack API',
    version: '1.0.0',
    description:
      'B2B SSO gateway featuring per-tenant SAML 2.0 assertions, Just-In-Time role mapping, internal JWT issuance, and an in-memory SCIM 2.0 provisioning router.',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Development Gateway',
    },
  ],
  paths: {
    '/api/auth/saml/{tenantId}/login': {
      get: {
        summary: 'Initiate SAML SSO Login',
        description:
          "Builds the tenant's SAML strategy from Secrets Manager and redirects the user to their configured Okta/Entra IdP.",
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '302': { description: 'Redirect to the enterprise IdP' },
          '500': { description: 'SSO configuration failed for tenant' },
        },
      },
    },
    '/api/auth/saml/{tenantId}/callback': {
      post: {
        summary: 'SAML Assertion Consumer Service',
        description:
          'Consumes the signed SAML assertion POSTed by the IdP, maps groups to an internal role, and issues an internal JWT.',
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Authentication successful; internal JWT issued' },
          '401': { description: 'SAML assertion failed' },
          '500': { description: 'Assertion processing failed' },
        },
      },
    },
    '/scim/v2/Users': {
      post: {
        summary: 'Provision a User (SCIM)',
        description: 'Provisions a user into the in-memory store. Called by the IdP over SCIM 2.0.',
        security: [{ bearerAuth: [] }],
        responses: {
          '201': { description: 'User successfully provisioned' },
          '400': { description: 'userName is required' },
          '401': { description: 'Unauthorized SCIM token' },
          '409': { description: 'User already exists' },
        },
      },
      get: {
        summary: 'List provisioned Users (SCIM)',
        description: 'Returns a SCIM ListResponse of all provisioned users.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'SCIM ListResponse' },
          '401': { description: 'Unauthorized SCIM token' },
        },
      },
    },
    '/scim/v2/Users/{id}': {
      get: {
        summary: 'Read a User (SCIM)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'The SCIM user resource' },
          '401': { description: 'Unauthorized SCIM token' },
          '404': { description: 'User not found' },
        },
      },
      patch: {
        summary: 'Activate / deactivate a User (SCIM)',
        description:
          "SCIM PatchOp on the `active` attribute — the deprovision path IdPs use (`op: replace {active:false}`). Also accepts a plain `{active}` body.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated SCIM user resource' },
          '400': { description: 'Unsupported PATCH (only `active` is honoured)' },
          '401': { description: 'Unauthorized SCIM token' },
          '404': { description: 'User not found' },
        },
      },
      delete: {
        summary: 'Deprovision a User (SCIM)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': { description: 'User deprovisioned' },
          '401': { description: 'Unauthorized SCIM token' },
          '404': { description: 'User not found' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
};
