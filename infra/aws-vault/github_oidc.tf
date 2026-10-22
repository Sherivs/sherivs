resource "aws_iam_openid_connect_provider" "github" {
  count           = var.enable_github_oidc ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"] # ignored by AWS for this issuer, required by API
}

data "aws_iam_policy_document" "gha_trust" {
  count = var.enable_github_oidc ? 1 : 0
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github[0].arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "gha" {
  count                = var.enable_github_oidc ? 1 : 0
  name                 = "sherivs-gha"
  assume_role_policy   = data.aws_iam_policy_document.gha_trust[0].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "gha" {
  count = var.enable_github_oidc ? 1 : 0
  statement {
    sid       = "ReadCiParams"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["${local.ssm_arn}/sherivs/ci", "${local.ssm_arn}/sherivs/ci/*"]
  }
  statement {
    sid       = "DecryptPlatformViaSsm"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.platform.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
  dynamic "statement" {
    for_each = var.tf_state_bucket == "" ? [] : [1]
    content {
      sid       = "ReadStateBucket"
      actions   = ["s3:ListBucket", "s3:GetObject", "s3:GetBucketVersioning"]
      resources = ["arn:${local.p}:s3:::${var.tf_state_bucket}", "arn:${local.p}:s3:::${var.tf_state_bucket}/*"]
    }
  }
}

resource "aws_iam_role_policy" "gha" {
  count  = var.enable_github_oidc ? 1 : 0
  name   = "sherivs-gha-read"
  role   = aws_iam_role.gha[0].id
  policy = data.aws_iam_policy_document.gha[0].json
}
