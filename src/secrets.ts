import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize the AWS Secrets Manager Client
// In production, IAM Roles attached to the EC2/ECS/EKS instances provide the necessary credentials implicitly.
const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

export interface TenantSamlConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
}

/**
 * Retrieves dynamic SAML configurations for a specific tenant.
 * Uses AWS Secrets Manager to ensure we aren't storing sensitive 
 * certificates or endpoints in application code or plain databases.
 */
export async function getTenantConfig(tenantId: string): Promise<TenantSamlConfig> {
  const secretName = `sso/tenant/${tenantId}`;
  
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);
    
    if (response.SecretString) {
      return JSON.parse(response.SecretString) as TenantSamlConfig;
    }
    
    throw new Error('Secret binary not supported directly without buffer conversion.');
  } catch (error) {
    // In production a missing or unreadable secret is a hard failure — never
    // silently serve a mock IdP config, which would let anyone authenticate
    // against a fake identity provider.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Unable to load SAML config for tenant ${tenantId}`);
    }

    console.warn(`[Secrets] Failed to fetch config for tenant ${tenantId}. Using dev mock.`);
    // Fallback mock for local demonstration only.
    return {
      entryPoint: 'https://dev-mock-idp.example.com/app/saml/sso/saml',
      issuer: 'https://dev-mock-idp.example.com',
      cert: 'mock_cert_string_from_idp'
    };
  }
}
