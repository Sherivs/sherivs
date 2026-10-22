# Sherivs AWS vault (phase 2)

Account 508575763030, region eu-north-1. **Applied 2026-10-22** (see below). Original plan with OIDC: 28 add / 0 change / 0 destroy.

Creates: KMS `alias/sherivs-platform` + `alias/sherivs-tenant` (365-day rotation); empty Secrets Manager
placeholders `sherivs/prod/{paystack-secret-key,database-url,supabase-service-role-key}`; GitHub OIDC + `sherivs-gha`
(master only, read `/sherivs/ci/*`, optional state bucket); Vercel OIDC (team issuer) + `sherivs-vercel`
(production only, read `/sherivs/prod/*`, decrypt platform key); additive policies on `sherivs-automate-backup-role`
(read `/sherivs/n8n/*`, tenant key, AmazonSSMManagedInstanceCore); multi-region CloudTrail → CW Logs; break-glass
user (no keys, no password in TF) + console-login alarm → SNS.

SSM SecureString values are written out of band (`aws ssm put-parameter --type SecureString --key-id alias/sherivs-platform`), never in TF.

To enable OIDC later: (1) org SCP currently denies `iam:*OpenIDConnectProvider*` for this account — needs an exception;
(2) confirm `vercel_team_slug` and the Vercel thumbprint; (3) set `tf_state_bucket`. Break-glass password + MFA are set manually (not in TF).

## Applied 2026-10-22
23 added / 0 changed / 0 destroyed. GitHub/Vercel OIDC excluded (`enable_github_oidc`/`enable_vercel_oidc` = false, SCP block).
State: s3://sherivs-tfstate-508575763030/aws-vault/terraform.tfstate (bootstrapped by CLI: private, versioned, SSE-S3, TLS-only, public access blocked). State locking: S3 native lockfile (`use_lockfile = true`, Terraform >= 1.10; verified with 1.13.4, plan = no changes).

## Vault contents (names only, loaded 2026-10-22, SecureString / alias/sherivs-platform)
- /sherivs/n8n/: n8n-encryption-key, postgres-password, backup-passphrase, n8n-sandbox-version, sandbox-api-keys, sandbox-api-runner-registration-token, sandbox-api-runner-api-key, n8n-sandbox-url, n8n-sandbox-api-key, sentry-dsn, posthog-project-api-key, twilio-account-sid, twilio-api-key, twilio-api-secret, redis-rest-url, redis-rest-token, vapi-api-key, vapid-public-key, vapid-private-key, vapid-subject
- /sherivs/ops/: betterstack-api-token, supabase-access-token
- /sherivs/ci/: backup-passphrase
- Secrets Manager: sherivs/prod/database-url (filled); sherivs/prod/paystack-secret-key, sherivs/prod/supabase-service-role-key (empty — owner to load via secure box)

Source .env files on the server and box are intentionally left in place; services still read them.
