import rateLimit, { MINUTE, type Options } from 'express-rate-limit';

/**
 * Reads a positive integer from the environment, falling back to the default when
 * the variable is unset or not a usable number. A typo should not silently disable
 * the limiter.
 */
export const limitFrom = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const WINDOW_MS = 15 * MINUTE;

const shared: Partial<Options> = {
  windowMs: WINDOW_MS,
  // draft-8 RateLimit headers, so a client can read its remaining budget instead of
  // discovering the ceiling by hitting it.
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests for this endpoint. Retry once the window resets.' },
};

/**
 * Caps the SAML SSO endpoints.
 *
 * Why these need a cap at all: `/api/auth/saml/:tenantId/login` is unauthenticated,
 * and resolving the tenant's IdP goes through `getTenantConfig`, which is a live AWS
 * Secrets Manager call on every request by design (that is what makes a rotated
 * certificate take effect immediately). So anyone who can guess a tenant slug can
 * drive billable API calls as fast as they can open sockets, and the bill lands on
 * the operator. That is the denial-of-wallet case, not a theoretical one.
 *
 * Why the cap is loose: a B2B tenant egresses through a handful of NAT addresses, so
 * several hundred real employees can share one source IP during a morning login
 * rush. A tight per-IP limit locks out a paying customer, which is a worse failure
 * than the abuse it prevents. This stops the automated hammering and nothing else.
 *
 * Per-IP is the blunt baseline. Per-tenant accounting and an edge WAF are the
 * production upgrade, and a shared store (Redis) is required the moment this runs on
 * more than one process, since the default store counts per process.
 */
export const ssoLimiter = rateLimit({ ...shared, limit: limitFrom('SSO_RATE_LIMIT', 600) });

/**
 * Caps the SCIM provisioning router.
 *
 * SCIM is bearer-authenticated, so the thing worth limiting here is guessing at that
 * token. Provisioning is machine-to-machine and arrives in bursts when an IdP
 * reconciles a directory, so this stays generous enough not to stall a real sync.
 */
export const scimLimiter = rateLimit({ ...shared, limit: limitFrom('SCIM_RATE_LIMIT', 300) });
