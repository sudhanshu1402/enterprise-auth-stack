import { describe, it, expect } from 'vitest';
import { extractActiveFromPatch } from '../src/routes/scim';

// The SCIM PATCH handler delegates its parsing to extractActiveFromPatch, so
// pinning that function covers the deprovision/reactivate logic without an HTTP
// round-trip. These payloads mirror what Okta / Entra actually send.
describe('extractActiveFromPatch', () => {
  it('reads active:false from the RFC 7644 PatchOp envelope (Okta deprovision)', () => {
    const body = {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', value: { active: false } }],
    };
    expect(extractActiveFromPatch(body)).toBe(false);
  });

  it('reads active:true for reactivation', () => {
    const body = { Operations: [{ op: 'replace', value: { active: true } }] };
    expect(extractActiveFromPatch(body)).toBe(true);
  });

  it('accepts op:add as well as replace', () => {
    expect(extractActiveFromPatch({ Operations: [{ op: 'add', value: { active: false } }] })).toBe(false);
  });

  it('supports the path:"active" form with a bare boolean value', () => {
    expect(extractActiveFromPatch({ Operations: [{ op: 'replace', path: 'active', value: false }] })).toBe(false);
  });

  it('supports the plain { active } shorthand', () => {
    expect(extractActiveFromPatch({ active: true })).toBe(true);
  });

  it('is case-insensitive on the op name', () => {
    expect(extractActiveFromPatch({ Operations: [{ op: 'Replace', value: { active: false } }] })).toBe(false);
  });

  it('returns undefined when no active toggle is present', () => {
    expect(extractActiveFromPatch({ Operations: [{ op: 'replace', value: { displayName: 'x' } }] })).toBeUndefined();
    expect(extractActiveFromPatch({ Operations: [] })).toBeUndefined();
    expect(extractActiveFromPatch({})).toBeUndefined();
  });

  it('returns undefined for non-object bodies', () => {
    expect(extractActiveFromPatch(null)).toBeUndefined();
    expect(extractActiveFromPatch('active')).toBeUndefined();
    expect(extractActiveFromPatch(undefined)).toBeUndefined();
  });

  it('ignores a non-boolean active value rather than coercing it', () => {
    // A string "false" must not be treated as a real toggle.
    expect(extractActiveFromPatch({ active: 'false' })).toBeUndefined();
    expect(extractActiveFromPatch({ Operations: [{ op: 'replace', value: { active: 'false' } }] })).toBeUndefined();
  });
});
