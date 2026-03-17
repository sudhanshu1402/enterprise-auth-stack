export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Enterprise Authentication Stack API',
    version: '1.0.0',
    description: 'B2B SSO Gateway featuring SAML 2.0 assertions, Just-In-Time role mapping, internal JWT issuance, and a mock SCIM 2.0 provisioning router.',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Development Gateway',
    },
  ],
  paths: {
    '/login': {
      get: {
        summary: 'Initiate SAML SSO Login',
        description: 'Redirects the user to the configured Okta/Entra IDP.',
        responses: {
          '302': { description: 'Redirect to IDP' },
        },
      },
    },
    '/scim/v2/Users': {
      post: {
        summary: 'Provision a User (SCIM)',
        description: 'Mock endpoint for Identity Providers to provision users via SCIM 2.0 protocol.',
        security: [{ bearerAuth: [] }],
        responses: {
          '201': { description: 'User successfully provisioned' },
          '401': { description: 'Unauthorized SCIM Token' }
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
