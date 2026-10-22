# SSM SecureString paths (/sherivs/prod/*, /sherivs/ci/*, /sherivs/n8n/*) are written
# out-of-band with: aws ssm put-parameter --type SecureString --key-id alias/sherivs-platform
# Terraform only grants access to them; no values live in code or state.
locals {
  ssm_arn = "arn:${local.p}:ssm:${var.region}:${local.account_id}:parameter"
  sm_placeholders = {
    "sherivs/prod/paystack-secret-key"       = "Paystack secret key (rotating)"
    "sherivs/prod/database-url"              = "Production DB connection URL (rotating)"
    "sherivs/prod/supabase-service-role-key" = "Supabase service role key (rotating)"
  }
}

# Empty placeholders: no aws_secretsmanager_secret_version => no value stored.
resource "aws_secretsmanager_secret" "prod" {
  for_each                = local.sm_placeholders
  name                    = each.key
  description             = each.value
  kms_key_id              = aws_kms_key.platform.arn
  recovery_window_in_days = 30
}
