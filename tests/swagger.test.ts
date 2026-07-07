import { describe, it, expect } from 'vitest';
import { swaggerDocument } from '../src/swagger';

// Pins the OpenAPI spec to the routes actually served in src/index.ts and
// src/routes/scim.ts, so documenting a nonexistent endpoint (or dropping a
// real one) fails here rather than misleading a reader of /api-docs.
describe('swaggerDocument', () => {
  it('declares an OpenAPI 3.0.0 document with metadata', () => {
    expect(swaggerDocument.openapi).toBe('3.0.0');
    expect(swaggerDocument.info.title.length).toBeGreaterThan(0);
    expect(swaggerDocument.info.version).toBe('1.0.0');
  });

  it('documents exactly the routes the app serves', () => {
    expect(Object.keys(swaggerDocument.paths).sort()).toEqual([
      '/api/auth/saml/{tenantId}/callback',
      '/api/auth/saml/{tenantId}/login',
      '/scim/v2/Users',
      '/scim/v2/Users/{id}',
    ]);
  });

  it('marks SCIM endpoints as bearer-secured', () => {
    const paths = swaggerDocument.paths as Record<string, any>;
    expect(paths['/scim/v2/Users'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(paths['/scim/v2/Users/{id}'].delete.security).toEqual([{ bearerAuth: [] }]);
    expect(swaggerDocument.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('documents the SCIM PATCH (active toggle) deprovision path', () => {
    const patch = (swaggerDocument.paths as Record<string, any>)['/scim/v2/Users/{id}'].patch;
    expect(patch).toBeDefined();
    expect(patch.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(patch.responses).sort()).toEqual(['200', '400', '401', '404']);
  });

  it('documents the SCIM provisioning conflict and validation responses', () => {
    const post = (swaggerDocument.paths as Record<string, any>)['/scim/v2/Users'].post;
    expect(Object.keys(post.responses).sort()).toEqual(['201', '400', '401', '409']);
  });
});
