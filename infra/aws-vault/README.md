# Sherivs AWS vault (phase 2)

Account 508575763030, region eu-north-1. **Not applied.** Plan: 28 add / 0 change / 0 destroy.

Creates: KMS `alias/sherivs-platform` + `alias/sherivs-tenant` (365-day rotation); empty Secrets Manager
placeholders `sherivs/prod/{paystack-secret-key,database-url,supabase-service-role-key}`; GitHub OIDC + `sherivs-gha`
(master only, read `/sherivs/ci/*`, optional state bucket); Vercel OIDC (team issuer) + `sherivs-vercel`
(production only, read `/sherivs/prod/*`, decrypt platform key); additive policies on `sherivs-automate-backup-role`
(read `/sherivs/n8n/*`, tenant key, AmazonSSMManagedInstanceCore); multi-region CloudTrail → CW Logs; break-glass
user (no keys, no password in TF) + console-login alarm → SNS.

SSM SecureString values are written out of band (`aws ssm put-parameter --type SecureString --key-id alias/sherivs-platform`), never in TF.

Before apply: (1) org SCP currently denies `iam:*OpenIDConnectProvider*` for this account — needs an exception;
(2) confirm `vercel_team_slug` and the Vercel thumbprint; (3) set `tf_state_bucket` and a remote backend;
(4) set `alarm_email`; (5) break-glass password + MFA set manually after apply.

## Applied 2026-10-22
23 added / 0 changed / 0 destroyed. GitHub/Vercel OIDC excluded (`enable_github_oidc`/`enable_vercel_oidc` = false, SCP block).
State: s3://sherivs-tfstate-508575763030/aws-vault/terraform.tfstate (bootstrapped by CLI: private, versioned, SSE-S3, TLS-only, public access blocked). No state locking on TF 1.9 — run applies serially (or use TF >= 1.10 `use_lockfile = true`).
