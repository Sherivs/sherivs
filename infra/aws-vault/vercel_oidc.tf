# Vercel OIDC, team issuer mode: iss = https://oidc.vercel.com/<team_slug>
locals {
  vercel_host = "oidc.vercel.com/${var.vercel_team_slug}"
}

resource "aws_iam_openid_connect_provider" "vercel" {
  url             = "https://${local.vercel_host}"
  client_id_list  = ["https://vercel.com/${var.vercel_team_slug}"]
  thumbprint_list = ["9e99a48a9960b14926bb7f3b02e22da2b0ab7280"] # verify before apply
}

data "aws_iam_policy_document" "vercel_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.vercel.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.vercel_host}:aud"
      values   = ["https://vercel.com/${var.vercel_team_slug}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.vercel_host}:sub"
      values   = ["owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:production"]
    }
  }
}

resource "aws_iam_role" "vercel" {
  name                 = "sherivs-vercel"
  assume_role_policy   = data.aws_iam_policy_document.vercel_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "vercel" {
  statement {
    sid       = "ReadProdParams"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["${local.ssm_arn}/sherivs/prod", "${local.ssm_arn}/sherivs/prod/*"]
  }
  statement {
    sid       = "ReadProdSecrets"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [for s in aws_secretsmanager_secret.prod : s.arn]
  }
  statement {
    sid       = "DecryptPlatform"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.platform.arn]
  }
}

resource "aws_iam_role_policy" "vercel" {
  name   = "sherivs-vercel-read"
  role   = aws_iam_role.vercel.id
  policy = data.aws_iam_policy_document.vercel.json
}
