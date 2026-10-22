locals {
  account_id = data.aws_caller_identity.current.account_id
  p          = data.aws_partition.current.partition
}

data "aws_iam_policy_document" "kms_base" {
  statement {
    sid       = "AccountRoot"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.p}:iam::${local.account_id}:root"]
    }
  }
}

resource "aws_kms_key" "platform" {
  description             = "Sherivs platform secrets (SSM /sherivs/*, Secrets Manager sherivs/prod/*)"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_base.json
}
resource "aws_kms_alias" "platform" {
  name          = "alias/sherivs-platform"
  target_key_id = aws_kms_key.platform.key_id
}

resource "aws_kms_key" "tenant" {
  description             = "Sherivs tenant data / n8n credentials"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_base.json
}
resource "aws_kms_alias" "tenant" {
  name          = "alias/sherivs-tenant"
  target_key_id = aws_kms_key.tenant.key_id
}
