import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { limitFrom } from '../src/rateLimit';

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** Mounts one middleware on a throwaway loopback server and returns its port. */
async function serve(middleware: express.RequestHandler): Promise<number> {
  const app = express();
  app.get('/probe', middleware, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => {
      server = s;
      resolve((s.address() as { port: number }).port);
    });
  });
}

describe('limitFrom', () => {
  const NAME = 'TEST_RATE_LIMIT_VALUE';
  beforeEach(() => {
    delete process.env[NAME];
  });
  afterEach(() => {
    delete process.env[NAME];
  });

  it('uses the fallback when the variable is unset', () => {
    expect(limitFrom(NAME, 600)).toBe(600);
  });

  it('reads a positive integer override', () => {
    process.env[NAME] = '25';
    expect(limitFrom(NAME, 600)).toBe(25);
  });

  // A typo must not silently disable the limiter, which is what happens if a
  // non-numeric value is passed straight through to `limit`.
  it.each(['0', '-5', 'abc', '', '12.5'])('falls back rather than trusting %o', (bad) => {
    process.env[NAME] = bad;
    expect(limitFrom(NAME, 600)).toBe(600);
  });
});

describe('sso limiter', () => {
  it('serves up to the limit, then answers 429 with a JSON body', async () => {
    process.env.SSO_RATE_LIMIT = '3';
    // The module resolves its limits at import time, so it is imported after the
    // override is in place. This also proves the override actually reaches rateLimit.
    vi.resetModules();
    const { ssoLimiter } = await import('../src/rateLimit');
    const port = await serve(ssoLimiter);

    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(`http://127.0.0.1:${port}/probe`);
      codes.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get('content-type')).toContain('application/json');
        expect((await res.json()).error).toMatch(/Too many requests/i);
        // draft-8 headers let a caller read its budget instead of discovering the
        // ceiling by hitting it.
        expect(res.headers.get('ratelimit')).toBeTruthy();
      }
    }

    expect(codes).toEqual([200, 200, 200, 429]);
    delete process.env.SSO_RATE_LIMIT;
  });
});
