import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  createUser,
  getUser,
  listUsers,
  setUserActive,
  deleteUser,
  DuplicateUserError,
  ScimUser,
} from '../store/userStore';

export const scimRouter = Router();

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

// SCIM error envelope. `scimType` is required by RFC 7644 for certain errors
// (e.g. `uniqueness` on a duplicate, `invalidValue` on a bad attribute) — Okta
// and Entra branch on it, so omitting it turns a recoverable 409 into a hard sync failure.
const scimError = (res: Response, status: number, detail: string, scimType?: string) => {
  const body: Record<string, unknown> = { schemas: [ERROR_SCHEMA], detail, status: String(status) };
  if (scimType) body.scimType = scimType;
  return res.status(status).json(body);
};

const toScimResource = (user: ScimUser) => ({
  schemas: [USER_SCHEMA],
  id: user.id,
  userName: user.userName,
  name: user.name,
  active: user.active,
});

const constantTimeEquals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; the length check itself is not a
  // secret (the token's length isn't sensitive), so short-circuiting is fine.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

/**
 * SCIM authentication — a shared bearer token, as IdPs use for outbound
 * provisioning calls. Guards every route on this router.
 *
 * Fails closed in production: if SCIM_BEARER_TOKEN is unset we refuse to fall
 * back to the built-in dev token (which is visible in source), rather than
 * silently accepting a credential anyone can read.
 */
const requireScimToken = (req: Request, res: Response, next: NextFunction) => {
  const configuredToken = process.env.SCIM_BEARER_TOKEN;

  if (!configuredToken && process.env.NODE_ENV === 'production') {
    return scimError(res, 500, 'SCIM bearer token is not configured');
  }

  const expectedToken = `Bearer ${configuredToken || 'test_scim_token_here'}`;
  const authHeader = req.headers.authorization;

  if (!authHeader || !constantTimeEquals(authHeader, expectedToken)) {
    return scimError(res, 401, 'Unauthorized SCIM Request');
  }
  next();
};

scimRouter.use(requireScimToken);

/**
 * SCIM 2.0 User provisioning.
 * Called by Okta / Entra ID when an admin assigns a user to the app.
 * Persists to the in-process user store and returns the created resource
 * with its server-assigned id.
 */
scimRouter.post('/Users', (req: Request, res: Response) => {
  const { userName, name, active } = req.body ?? {};

  if (typeof userName !== 'string' || userName.length === 0) {
    return scimError(res, 400, 'userName is required', 'invalidValue');
  }
  if (active !== undefined && typeof active !== 'boolean') {
    return scimError(res, 400, 'active must be a boolean', 'invalidValue');
  }

  try {
    const user = createUser({ userName, name, active });
    console.log(`[SCIM] Provisioned user ${user.userName} -> ${user.id}`);
    return res.status(201).json(toScimResource(user));
  } catch (err) {
    if (err instanceof DuplicateUserError) {
      return scimError(res, 409, 'User already exists', 'uniqueness');
    }
    throw err;
  }
});

/** SCIM 2.0 list — lets the IdP reconcile its directory against ours. */
scimRouter.get('/Users', (_req: Request, res: Response) => {
  const resources = listUsers().map(toScimResource);
  res.status(200).json({
    schemas: [LIST_SCHEMA],
    totalResults: resources.length,
    Resources: resources,
  });
});

/** SCIM 2.0 single-resource read. */
scimRouter.get('/Users/:id', (req: Request, res: Response) => {
  const user = getUser(String(req.params.id));
  if (!user) {
    return scimError(res, 404, 'User not found');
  }
  res.status(200).json(toScimResource(user));
});

/**
 * Pull the target `active` value out of a SCIM PATCH body.
 * Accepts the RFC 7644 PatchOp envelope
 *   { Operations: [{ op: 'replace', value: { active: false } }] }
 * (also `path: 'active'` with a bare boolean value) as well as a plain
 * `{ active: boolean }` shorthand. Only the `active` attribute is honoured;
 * returns undefined when no active-toggle is present.
 */
export function extractActiveFromPatch(body: unknown): boolean | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, any>;

  if (typeof b.active === 'boolean') return b.active;

  const ops = Array.isArray(b.Operations) ? b.Operations : [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const opName = typeof op.op === 'string' ? op.op.toLowerCase() : '';
    if (opName !== 'replace' && opName !== 'add') continue;

    if (op.value && typeof op.value === 'object' && typeof op.value.active === 'boolean') {
      return op.value.active;
    }
    if (typeof op.path === 'string' && op.path.toLowerCase() === 'active' && typeof op.value === 'boolean') {
      return op.value;
    }
  }
  return undefined;
}

/**
 * SCIM 2.0 PATCH — the deprovision path IdPs actually use. Okta/Entra send
 * `op: replace {active:false}` to disable a user rather than DELETE, and
 * `active:true` to re-enable. Only the `active` attribute is supported here.
 */
scimRouter.patch('/Users/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!getUser(id)) {
    return scimError(res, 404, 'User not found');
  }

  const nextActive = extractActiveFromPatch(req.body);
  if (nextActive === undefined) {
    return scimError(res, 400, 'PATCH only supports replacing the `active` attribute', 'invalidValue');
  }

  const updated = setUserActive(id, nextActive);
  console.log(`[SCIM] ${nextActive ? 'Reactivated' : 'Deactivated'} user ${id}`);
  // getUser() above already confirmed existence, so updated is defined here.
  return res.status(200).json(toScimResource(updated as ScimUser));
});

/**
 * SCIM 2.0 hard delete. Removes the user from the store.
 * Returns 404 when the id is unknown so IdP sync loops don't silently succeed.
 */
scimRouter.delete('/Users/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const removed = deleteUser(id);
  if (!removed) {
    return scimError(res, 404, 'User not found');
  }
  console.log(`[SCIM] Deprovisioned user ${id}`);
  res.status(204).send();
});
