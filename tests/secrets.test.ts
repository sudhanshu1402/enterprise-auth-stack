import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the AWS SDK so no real network/credentials are needed. `vi.hoisted`
// makes the mock fn available inside the hoisted vi.mock factory without a TDZ.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  // Real classes so `new SecretsManagerClient()` / `new GetSecretValueCommand()`
  // work — an arrow fn can't be used as a constructor.
  SecretsManagerClient: class {
    send = sendMock;
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { getTenantConfig } from '../src/secrets';

const REAL_CONFIG = {
  entryPoint: 'https://okta.example.com/app/sso/saml',
  issuer: 'https://okta.example.com',
  cert: 'MIID-real-cert',
};

let prevNodeEnv: string | undefined;

beforeEach(() => {
  sendMock.mockReset();
  prevNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
});

describe('getTenantConfig', () => {
  it('parses and returns the SecretString when Secrets Manager responds', async () => {
    sendMock.mockResolvedValueOnce({ SecretString: JSON.stringify(REAL_CONFIG) });
    await expect(getTenantConfig('acme')).resolves.toEqual(REAL_CONFIG);
  });

  it('falls back to the dev mock config when Secrets Manager errors (non-production)', async () => {
    process.env.NODE_ENV = 'development';
    sendMock.mockRejectedValueOnce(new Error('AccessDeniedException'));
    const cfg = await getTenantConfig('acme');
    expect(cfg.entryPoint).toContain('dev-mock-idp');
    expect(cfg.cert).toBe('mock_cert_string_from_idp');
  });

  it('falls back to the dev mock when the secret has no SecretString', async () => {
    process.env.NODE_ENV = 'development';
    sendMock.mockResolvedValueOnce({});
    const cfg = await getTenantConfig('acme');
    expect(cfg.entryPoint).toContain('dev-mock-idp');
  });

  it('throws instead of serving a mock when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    sendMock.mockRejectedValueOnce(new Error('AccessDeniedException'));
    await expect(getTenantConfig('acme')).rejects.toThrow(/Unable to load SAML config/);
  });
});
