import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUser,
  getUser,
  listUsers,
  setUserActive,
  deleteUser,
  DuplicateUserError,
  _resetStore,
} from '../src/store/userStore';

// The store is a module singleton, so wipe it before each test to keep the
// cases independent.
beforeEach(() => _resetStore());

describe('userStore', () => {
  it('assigns a unique id and defaults active to true on create', () => {
    const user = createUser({ userName: 'jane@corp.com', name: { givenName: 'Jane' } });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.userName).toBe('jane@corp.com');
    expect(user.active).toBe(true);
    // The returned id round-trips through getUser.
    expect(getUser(user.id)).toEqual(user);
  });

  it('gives every created user a distinct id', () => {
    const a = createUser({ userName: 'a@corp.com' });
    const b = createUser({ userName: 'b@corp.com' });
    expect(a.id).not.toBe(b.id);
    expect(listUsers()).toHaveLength(2);
  });

  it('honours an explicit active:false on create', () => {
    const user = createUser({ userName: 'dormant@corp.com', active: false });
    expect(user.active).toBe(false);
  });

  it('rejects a duplicate userName with DuplicateUserError', () => {
    createUser({ userName: 'dup@corp.com' });
    expect(() => createUser({ userName: 'dup@corp.com' })).toThrow(DuplicateUserError);
    // The failed create must not have added a second record.
    expect(listUsers()).toHaveLength(1);
  });

  it('returns undefined when reading an unknown id', () => {
    expect(getUser('does-not-exist')).toBeUndefined();
  });

  it('setUserActive(false) flips active but keeps the record', () => {
    const user = createUser({ userName: 'leaver@corp.com' });
    const updated = setUserActive(user.id, false);
    expect(updated?.active).toBe(false);
    expect(getUser(user.id)?.active).toBe(false);
    expect(listUsers()).toHaveLength(1);
  });

  it('setUserActive(true) reactivates a disabled user', () => {
    const user = createUser({ userName: 'returner@corp.com', active: false });
    expect(setUserActive(user.id, true)?.active).toBe(true);
    expect(getUser(user.id)?.active).toBe(true);
  });

  it('setUserActive returns undefined for an unknown id', () => {
    expect(setUserActive('nope', false)).toBeUndefined();
  });

  it('delete removes the record and returns true', () => {
    const user = createUser({ userName: 'gone@corp.com' });
    expect(deleteUser(user.id)).toBe(true);
    expect(getUser(user.id)).toBeUndefined();
    expect(listUsers()).toHaveLength(0);
  });

  it('delete returns false for an unknown id', () => {
    expect(deleteUser('nope')).toBe(false);
  });

  it('frees the userName after delete so it can be re-provisioned', () => {
    const first = createUser({ userName: 'recycle@corp.com' });
    deleteUser(first.id);
    // Re-creating the same userName must now succeed with a fresh id.
    const second = createUser({ userName: 'recycle@corp.com' });
    expect(second.id).not.toBe(first.id);
  });
});
