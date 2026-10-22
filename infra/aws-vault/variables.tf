variable "region" {
  type    = string
  default = "eu-north-1"
}
variable "github_repo" {
  type    = string
  default = "vibeoraai-bit/coregrid-scholar-migration"
}
variable "github_branch" {
  type    = string
  default = "master"
}
variable "vercel_team_slug" {
  description = "Vercel team slug used in the OIDC issuer (team issuer mode). Confirm in Vercel > Settings."
  type        = string
  default     = "vibeora"
}
variable "vercel_project_name" {
  type    = string
  default = "coregrid-scholar-migration"
}
variable "tf_state_bucket" {
  description = "Terraform state bucket the GHA role may read. Empty = no statement (current TF_STATE_* bucket is S3-compatible/unknown)."
  type        = string
  default     = ""
}
variable "ec2_instance_role_name" {
  type    = string
  default = "sherivs-automate-backup-role"
}
variable "enable_cloudtrail" {
  description = "No trail exists in the account today; create a multi-region management-events trail (needed for the break-glass login alarm)."
  type        = bool
  default     = true
}
variable "alarm_email" {
  description = "Email subscribed to the break-glass alarm topic (confirmation required). Empty = topic only."
  type        = string
  default     = "Info@sherivs.com"
}
variable "breakglass_user_name" {
  type    = string
  default = "sherivs-breakglass"
}
variable "enable_github_oidc" {
  description = "GitHub OIDC provider + sherivs-gha role. Off: org SCP p-wnxmh4dc denies iam:*OpenIDConnectProvider*."
  type        = bool
  default     = false
}
variable "enable_vercel_oidc" {
  description = "Vercel OIDC provider + sherivs-vercel role. Off: blocked by org SCP."
  type        = bool
  default     = false
}
