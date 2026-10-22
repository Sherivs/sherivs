# Existing role (created outside Terraform) — referenced, not managed. Only additive attachments.
data "aws_iam_role" "worker" {
  name = var.ec2_instance_role_name
}

data "aws_iam_policy_document" "worker_vault" {
  statement {
    sid       = "ReadN8nParams"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["${local.ssm_arn}/sherivs/n8n", "${local.ssm_arn}/sherivs/n8n/*"]
  }
  statement {
    sid       = "DecryptN8nParamsPlatformKeyViaSsm"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.platform.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "TenantKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.tenant.arn]
  }
}

resource "aws_iam_role_policy" "worker_vault" {
  name   = "sherivs-n8n-vault-read"
  role   = data.aws_iam_role.worker.name
  policy = data.aws_iam_policy_document.worker_vault.json
}

resource "aws_iam_role_policy_attachment" "worker_ssm_core" {
  role       = data.aws_iam_role.worker.name
  policy_arn = "arn:${local.p}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
