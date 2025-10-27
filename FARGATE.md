# Fargate Deploy Guide (CLI)

## Prereqs
- AWS CLI v2, Docker, IAM perms (ECR/ECS/Logs/Secrets)
- Private subnets + NAT (egress 443)
- Security Group: egress 443 open

## Secrets (Secrets Manager)
- WS_URL (wss://...)
- WEBHOOK_URL (https://.../api/oracle-hook)
- WEBHOOK_SECRET (your hmac secret)
- ORACLES (comma separated 0x...)

## Deploy
export ACCOUNT_ID=111122223333
export REGION=eu-central-1
export SUBNETS=subnet-aaaa,subnet-bbbb
export SECGRP=sg-0123456789abcdef0
bash deploy.sh
