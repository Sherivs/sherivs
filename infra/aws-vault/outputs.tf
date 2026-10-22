output "platform_key_arn" { value = aws_kms_key.platform.arn }
output "tenant_key_arn" { value = aws_kms_key.tenant.arn }
output "gha_role_arn" { value = one(aws_iam_role.gha[*].arn) }
output "vercel_role_arn" { value = one(aws_iam_role.vercel[*].arn) }
