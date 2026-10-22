terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
  # Plan-only for now: local state. Before apply, move to a remote, versioned
  # S3 backend (see README) — local state is a defect per infrastructure/terraform/README.
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "sherivs", Stack = "aws-vault", ManagedBy = "terraform" } }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
