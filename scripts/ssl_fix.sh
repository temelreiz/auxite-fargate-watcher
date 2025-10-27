#!/bin/zsh
set -e

echo "🔧 [1/7] Checking AWS CLI..."
aws --version || { echo "Installing awscli via Homebrew..."; brew install awscli; }

echo "🔧 [2/7] Updating AWS CLI..."
brew upgrade awscli || true

echo "🔧 [3/7] Installing/Linking CA bundle..."
CERT_CMD=$(find /Applications -type f -name "Install Certificates.command" 2>/dev/null | head -n 1 || true)
if [ -n "$CERT_CMD" ]; then
  echo "➡️  Running: $CERT_CMD"
  bash "$CERT_CMD"
else
  python3 -m pip install --upgrade certifi
  CA_BUNDLE=$(python3 -c 'import certifi; print(certifi.where())')
  aws configure set ca_bundle "$CA_BUNDLE"
fi

echo "🔧 [4/7] Exporting macOS root CAs as fallback..."
sudo security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/cacerts.pem || true
aws configure set ca_bundle /tmp/cacerts.pem

echo "🔧 [5/7] Validating AWS identity..."
aws sts get-caller-identity --region eu-central-1 1>/dev/null

echo "🔧 [6/7] Create/attach AWS Chatbot config (best-effort)..."
aws chatbot create-slack-channel-configuration \
  --slack-team-id T09P3715Q20 \
  --slack-channel-id C09NZMAA21Y \
  --sns-topic-arns arn:aws:sns:eu-central-1:809278147371:auxite-watcher-alarms \
  --configuration-name auxite-watcher-chatbot \
  --iam-role-arn arn:aws:iam::809278147371:role/service-role/AWS_Chatbot_Role \
  --region eu-central-1 \
  --no-cli-pager || echo "⚠️ Chatbot create skipped/failed (possibly already exists)."

echo "🔧 [7/7] Send SNS test..."
aws sns publish \
  --topic-arn arn:aws:sns:eu-central-1:809278147371:auxite-watcher-alarms \
  --message "🚀 Auxite Watcher SSL fix test" \
  --region eu-central-1 \
  --no-cli-pager

echo "✅ Done. Check Slack channel for the test message."

