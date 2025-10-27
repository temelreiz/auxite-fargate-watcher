#!/usr/bin/env bash
set -euo pipefail
ACCOUNT_ID="${ACCOUNT_ID:-111122223333}"
REGION="${REGION:-eu-central-1}"
REPO="auxite/oracle-watcher"
IMAGE="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO:latest"
CLUSTER="${CLUSTER:-auxite-cluster}"
SERVICE="${SERVICE:-auxite-oracle-watcher}"
TASK_FAMILY="${TASK_FAMILY:-auxite-oracle-watcher}"

aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 ||   aws ecr create-repository --repository-name "$REPO" --region "$REGION"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

docker build -t "$REPO" .
docker tag "$REPO:latest" "$IMAGE"
docker push "$IMAGE"

TMP=$(mktemp)
sed -e "s/<ACCOUNT_ID>/$ACCOUNT_ID/g" -e "s/<REGION>/$REGION/g" taskdef.json > "$TMP"
aws ecs register-task-definition --cli-input-json "file://$TMP" --region "$REGION" >/dev/null
REV=$(aws ecs describe-task-definition --task-definition "$TASK_FAMILY" --region "$REGION" --query 'taskDefinition.revision' --output text)

aws ecs describe-clusters --clusters "$CLUSTER" --region "$REGION" --query 'clusters[0].clusterArn' --output text >/dev/null 2>&1 ||   aws ecs create-cluster --cluster-name "$CLUSTER" --region "$REGION" >/dev/null

SUBNETS="${SUBNETS:-subnet-xxxx,subnet-yyyy}"
SECGRP="${SECGRP:-sg-abcdef123456}"

if aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" --query 'services[0].status' --output text >/dev/null 2>&1; then
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$TASK_FAMILY" --desired-count 1 --region "$REGION"
else
  aws ecs create-service     --cluster "$CLUSTER"     --service-name "$SERVICE"     --task-definition "$TASK_FAMILY"     --desired-count 1     --launch-type FARGATE     --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECGRP],assignPublicIp=DISABLED}"     --region "$REGION"
fi

echo "Deployed. Check CloudWatch Logs: /ecs/auxite-oracle-watcher"
