# Enterprise Auth Stack

A B2B SSO gateway that synthesizes SAML 2.0 Identity Provider assertions into unified JWTs, with SCIM 2.0 automated user provisioning and multi-tenant isolation backed by AWS Secrets Manager.

## Problem

Enterprise customers require SSO. Each customer uses a different Identity Provider (Okta, Azure AD, OneLogin) with different SAML configurations, certificates, and attribute mappings. Hardcoding IdP configs per tenant doesn't scale. Storing certificates in application code or databases creates security and rotation nightmares.

This stack dynamically resolves tenant-specific SAML configurations from AWS Secrets Manager at runtime, performs JIT role mapping from IdP group assertions, and issues a uniform internal JWT -- decoupling upstream identity complexity from downstream microservices.

## Architecture

```mermaid
graph TB
    Browser[Browser] -->|GET /saml/:tenantId/login| API[Express + Passport.js]
    API -->|Fetch tenant SAML config| SM[AWS Secrets Manager]
    SM -->|entryPoint, issuer, cert| API
    API -->|SAML AuthnRequest| IdP[Enterprise IdP - Okta / Azure AD]
    IdP -->|SAML Assertion POST| API
    API -->|JIT Role Mapping| JWT[Issue Internal JWT]
    JWT -->|Uniform token| MS[Internal Microservices]

    IdP2[IdP Admin Console] -->|SCIM 2.0 Push| SCIM[SCIM Provisioning Router]
    SCIM -->|Create/Delete Users| DB[(User Database)]

    style API fill:#2d3748,color:#fff
    style SM fill:#ff9900,color:#000
    style IdP fill:#0052cc,color:#fff
    style JWT fill:#059669,color:#fff
```

**Key architectural decisions:**
- **Dynamic strategy factory**: SAML strategies are constructed per-request using tenant-specific configs from Secrets Manager. No strategy caching -- ensures config rotation takes effect immediately.
- **JIT role mapping**: IdP group attributes (e.g., Okta's `groups: ["Admin"]`) are mapped to internal roles at assertion time, eliminating manual user provisioning.
- **Token abstraction**: Upstream IdP complexity (SAML vs OIDC) is hidden behind a uniform JWT interface. Downstream services never touch SAML.

## Tech Stack

| Technology | Why |
|---|---|
| **Passport.js + passport-saml** | De facto Node.js auth middleware. SAML strategy supports dynamic configuration per authentication attempt. |
| **AWS Secrets Manager** | Tenant SAML certificates and endpoints stored encrypted with automatic rotation support. IAM roles on ECS/EKS provide implicit credentials. |
| **jsonwebtoken** | Lightweight JWT issuance with configurable issuer, audience, and expiry. Internal services validate against shared secret or public key. |
| **Express 5** | Minimal HTTP layer. `urlencoded` middleware required for SAML POST binding assertion consumption. |

## Key Features

- **Multi-tenant SAML SSO** -- dynamic per-tenant IdP configuration resolved at runtime from Secrets Manager
- **JIT group-to-role mapping** -- IdP group assertions automatically mapped to internal RBAC roles
- **SCIM 2.0 provisioning** -- automated user create/delete from IdP admin consoles (Okta, Azure AD)
- **Token normalization** -- SAML assertions converted to uniform JWTs with `sub`, `email`, `tenantId`, `role` claims
- **Swagger documentation** -- OpenAPI 3.0 spec at `/api-docs`
- **Security defaults** -- non-root Docker user, audience validation, bearer token auth on SCIM endpoints

## Auth Flow

1. Client hits `GET /api/auth/saml/:tenantId/login`
2. Server pulls tenant's SAML config (entryPoint, issuer, cert) from AWS Secrets Manager
3. Passport constructs SAML AuthnRequest and redirects user to their enterprise IdP
4. IdP POSTs signed SAML assertion to `POST /api/auth/saml/:tenantId/callback`
5. Passport validates assertion signature against stored certificate
6. IdP groups mapped to internal roles (`Admin` -> `admin`, default -> `member`)
7. Internal JWT issued with 1h expiry, scoped to tenant and role
8. Downstream services validate JWT without any SAML awareness

## Scale Considerations

| Dimension | Current | Production Path |
|---|---|---|
| **Tenant count** | Unlimited (dynamic strategy creation) | Add Redis cache for Secrets Manager responses with 5min TTL to reduce API calls |
| **Session management** | Stateless (JWT) | No server-side session storage needed; horizontal scaling is free |
| **Certificate rotation** | Immediate (no caching) | Add cache-aside pattern with invalidation webhook from Secrets Manager rotation |
| **SCIM throughput** | Synchronous | Add queue-backed SCIM processing for bulk directory syncs (1000+ users) |

## Failure Handling

1. **Secrets Manager unavailable** -- falls back to mock config in dev; returns 500 in production
2. **Invalid SAML assertion** -- returns 401 with "SAML Assertion Failed"
3. **Unknown tenant** -- Secrets Manager returns not-found; surfaced as 500
4. **SCIM unauthorized** -- bearer token mismatch returns 401 before any provisioning logic

## Setup

```bash
npm install
cp .env.example .env  # Configure AWS_REGION, JWT keys, SCIM token
npm run dev
```

```bash
# Test SCIM provisioning
curl -X POST http://localhost:3000/scim/v2/Users \
  -H "Authorization: Bearer test_scim_token_here" \
  -H "Content-Type: application/json" \
  -d '{"userName": "jane@corp.com", "name": {"givenName": "Jane"}, "active": true}'
```

**Production deployment:**
```bash
docker build -t auth-stack .
docker run -e AWS_REGION=us-east-1 -e JWT_SECRET=... auth-stack
```

## Future Improvements

- [ ] OIDC provider support alongside SAML for modern IdPs
- [ ] Redis cache for Secrets Manager with rotation-triggered invalidation
- [ ] JWT signing with RS256 asymmetric keys (public key distribution to services)
- [ ] SCIM bulk operations endpoint for large directory syncs
- [ ] Audit logging for all authentication events (compliance trail)

## Deep-Dive Architecture

For a complete system design breakdown with Mermaid diagrams, visit the [System Design Portal](https://sudhanshu1402.github.io/system-design-portal/auth-stack).

## License

MIT
