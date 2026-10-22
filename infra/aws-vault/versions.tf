terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
  # Remote state: bootstrapped out of band (private, versioned, SSE-S3, TLS-only, public access blocked).
  backend "s3" {
    bucket       = "sherivs-tfstate-508575763030"
    key          = "aws-vault/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "sherivs", Stack = "aws-vault", ManagedBy = "terraform" } }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
