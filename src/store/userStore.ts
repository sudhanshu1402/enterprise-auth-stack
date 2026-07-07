import { randomUUID } from 'node:crypto';

/**
 * A minimal in-process SCIM user store.
 *
 * This is deliberately in-memory: the point of the demo is the SCIM request
 * lifecycle (auth, provisioning, deprovisioning, conflict handling), not
 * durable persistence. A production deployment would swap this module for a
 * repository backed by Postgres/Dynamo without touching the router.
 */

export interface ScimName {
  givenName?: string;
  familyName?: string;
}

export interface ScimUser {
  id: string;
  userName: string;
  name?: ScimName;
  active: boolean;
}

export class DuplicateUserError extends Error {
  constructor(userName: string) {
    super(`SCIM user already exists: ${userName}`);
    this.name = 'DuplicateUserError';
  }
}

// id -> user, plus a userName index so we can enforce SCIM's unique-userName rule.
const usersById = new Map<string, ScimUser>();
const idByUserName = new Map<string, string>();

export interface CreateUserInput {
  userName: string;
  name?: ScimName;
  active?: boolean;
}

export function createUser(input: CreateUserInput): ScimUser {
  if (idByUserName.has(input.userName)) {
    throw new DuplicateUserError(input.userName);
  }

  const user: ScimUser = {
    id: randomUUID(),
    userName: input.userName,
    name: input.name,
    active: input.active ?? true,
  };

  usersById.set(user.id, user);
  idByUserName.set(user.userName, user.id);
  return user;
}

export function getUser(id: string): ScimUser | undefined {
  return usersById.get(id);
}

export function listUsers(): ScimUser[] {
  return [...usersById.values()];
}

/**
 * Set a user's `active` flag. This is the SCIM soft-(de)provision primitive:
 * IdPs deprovision by PATCHing `active:false` (and reactivate with `true`)
 * rather than hard-deleting.
 */
export function setUserActive(id: string, active: boolean): ScimUser | undefined {
  const user = usersById.get(id);
  if (!user) return undefined;
  user.active = active;
  return user;
}

/** SCIM hard delete. Returns false when the id was unknown. */
export function deleteUser(id: string): boolean {
  const user = usersById.get(id);
  if (!user) return false;
  usersById.delete(id);
  idByUserName.delete(user.userName);
  return true;
}

/** Test-only: wipe all state so suites don't leak users into one another. */
export function _resetStore(): void {
  usersById.clear();
  idByUserName.clear();
}
