#!/usr/bin/env bash
set -euo pipefail

SERVICE="${LIGHTSAIL_SERVICE:-your-lightsail-service-name}"  # or set LIGHTSAIL_SERVICE env var
LABEL="scm-tools"

echo "==> Building image..."
docker build -t scm-tools .

echo "==> Pushing to Lightsail (service: $SERVICE)..."
aws lightsail push-container-image \
  --service-name "$SERVICE" \
  --label "$LABEL" \
  --image scm-tools

echo ""
echo "==> Push complete. Note the :scm-tools.N image name printed above."
echo "    Deploy via the Lightsail console, or update containers.json and run:"
echo "    aws lightsail create-container-service-deployment --service-name $SERVICE --containers file://containers.json --public-endpoint file://public-endpoint.json"
