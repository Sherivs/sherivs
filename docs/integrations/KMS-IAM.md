# Sherivs Vault on AWS KMS — required IAM (SHERIVS-091)

This PR adds the adapter only. **No IAM, key, alias or role is created by it.** An AWS admin of
account `508575763030` must do the following in `eu-north-1` before setting `SHERIVS_VAULT_KMS=aws`.

## 1. Key
- Symmetric KMS key, `SYMMETRIC_DEFAULT`, `ENCRYPT_DECRYPT`, automatic rotation **on** (yearly).
- Alias: `alias/sherivs-tenant`.
- Key policy: keep the account root statement; key administrators separate from users (no `kms:Decrypt` for admins).

## 2. Runtime role (the identity the Vercel functions use)
Prefer Vercel OIDC federation (`AssumeRoleWithWebIdentity`, no long-lived keys); trust policy
restricted to the Sherivs Vercel team/project and the `production` environment.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SherivsVaultEnvelope",
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "arn:aws:kms:eu-north-1:508575763030:key/<KEY-ID>",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:purpose": "sherivs-org-credential",
          "kms:RequestAlias": "alias/sherivs-tenant"
        },
        "Null": { "kms:EncryptionContext:org_id": "false" }
      }
    }
  ]
}
```
Notes
- `kms:RequestAlias` only matches calls made *by alias*. GenerateDataKey uses the alias; Decrypt passes
  the alias as `KeyId` as well, so the condition holds. If you prefer, drop it and keep the resource ARN.
- No `kms:Encrypt`, `kms:ReEncrypt*`, `kms:CreateGrant`, `kms:DescribeKey` or key-admin actions are needed.
- The encryption context (`purpose`, `org_id`) binds every data key to one school; KMS refuses a
  decrypt with another school's id, and CloudTrail records `org_id` on every call.

## 3. Environment (Vercel, production only)
| Var | Value |
|---|---|
| `SHERIVS_VAULT_KMS` | `aws` |
| `SHERIVS_KMS_KEY_ID` | `alias/sherivs-tenant` |
| `SHERIVS_KMS_REGION` | `eu-north-1` |
| `AWS_ROLE_ARN` | the runtime role (OIDC) |

## 4. Monitoring
CloudTrail data events for the key; alarm on `Decrypt` errors (`InvalidCiphertextException`,
`AccessDenied`) above a small threshold, and on any use outside the runtime role.

## 5. Rotation and recovery
KMS automatic rotation keeps old key material for decrypt, so stored `wrapped_dek` stays valid.
Deleting the key destroys every school's credentials: set a 30-day deletion window and a CloudWatch alarm on `ScheduleKeyDeletion`.
