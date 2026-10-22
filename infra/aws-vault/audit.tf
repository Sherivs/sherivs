# ---- CloudTrail (none exists today) ----
resource "aws_s3_bucket" "trail" {
  count         = var.enable_cloudtrail ? 1 : 0
  bucket        = "sherivs-cloudtrail-${local.account_id}"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "trail" {
  count                   = var.enable_cloudtrail ? 1 : 0
  bucket                  = aws_s3_bucket.trail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    id     = "expire-365d"
    status = "Enabled"
    filter {}
    expiration { days = 365 }
  }
}
data "aws_iam_policy_document" "trail_bucket" {
  count = var.enable_cloudtrail ? 1 : 0
  statement {
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.trail[0].arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.trail[0].arn}/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
}
resource "aws_s3_bucket_policy" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  policy = data.aws_iam_policy_document.trail_bucket[0].json
}

resource "aws_cloudwatch_log_group" "trail" {
  count             = var.enable_cloudtrail ? 1 : 0
  name              = "/sherivs/cloudtrail"
  retention_in_days = 90
}
data "aws_iam_policy_document" "trail_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "trail_logs" {
  count              = var.enable_cloudtrail ? 1 : 0
  name               = "sherivs-cloudtrail-logs"
  assume_role_policy = data.aws_iam_policy_document.trail_assume.json
}
resource "aws_iam_role_policy" "trail_logs" {
  count = var.enable_cloudtrail ? 1 : 0
  name  = "write-logs"
  role  = aws_iam_role.trail_logs[0].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.trail[0].arn}:*" }]
  })
}
resource "aws_cloudtrail" "main" {
  count                         = var.enable_cloudtrail ? 1 : 0
  name                          = "sherivs-management"
  s3_bucket_name                = aws_s3_bucket.trail[0].id
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.trail[0].arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.trail_logs[0].arn
  depends_on                    = [aws_s3_bucket_policy.trail]
}

# ---- Break-glass user: console only, NO access keys, NO password in Terraform ----
resource "aws_iam_user" "breakglass" {
  name          = var.breakglass_user_name
  force_destroy = false
}
resource "aws_iam_user_policy_attachment" "breakglass_admin" {
  user       = aws_iam_user.breakglass.name
  policy_arn = "arn:${local.p}:iam::aws:policy/AdministratorAccess"
}

resource "aws_sns_topic" "security" {
  name              = "sherivs-security-alerts"
  kms_master_key_id = "alias/aws/sns"
}
resource "aws_sns_topic_subscription" "security_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.security.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_log_metric_filter" "breakglass_login" {
  count          = var.enable_cloudtrail ? 1 : 0
  name           = "sherivs-breakglass-console-login"
  log_group_name = aws_cloudwatch_log_group.trail[0].name
  pattern        = "{ ($.eventName = \"ConsoleLogin\") && ($.userIdentity.userName = \"${var.breakglass_user_name}\") }"
  metric_transformation {
    name      = "BreakglassConsoleLogin"
    namespace = "Sherivs/Security"
    value     = "1"
  }
}
resource "aws_cloudwatch_metric_alarm" "breakglass_login" {
  count               = var.enable_cloudtrail ? 1 : 0
  alarm_name          = "sherivs-breakglass-console-login"
  namespace           = "Sherivs/Security"
  metric_name         = "BreakglassConsoleLogin"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.security.arn]
}
