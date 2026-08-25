# Design decisions

## One strategy, IdP config resolved per request

A cached per-tenant certificate means a rotated one keeps failing until something evicts it, so `getSamlOptions` re-reads Secrets Manager on every request and rotation takes effect immediately. That costs two API calls per login, one on the redirect and one on the callback, which is the right trade until the volume hurts.

The strategy itself is registered once (`MultiSamlStrategy`), because the InResponseTo replay cache has to outlive the redirect to the IdP: building a new strategy per request gave the callback an empty cache and `validateInResponseTo: always` would reject every assertion.

## JIT role mapping

Group attributes from the SAML assertion map to internal roles (`Admin` -> `admin`, everything else `member`) at login time, so nobody provisions users by hand before their first sign-in. The trade-off: a role change made at the IdP only takes effect the next time that user logs in, not immediately.

## Dev fallbacks fail closed

There's a mock IdP config for local work, and under `NODE_ENV=production` it's disabled: a missing tenant secret returns 500 instead of silently authenticating against a fake. SCIM refuses to start without `SCIM_BEARER_TOKEN` rather than defaulting to one, and token issuance throws without `JWT_SECRET_DEV_ONLY` rather than signing with the dev key that is visible in `src/auth/jwt.ts`.
