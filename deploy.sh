#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
SERVICE="exe-sc-tools"
DEPLOY_JSON="exe-sc-tools-deploy.json"

# ── mealstock app ──────────────────────────────────────────────
echo "==> Building mealstock..."
docker build -t mealstock-app .

echo "==> Pushing mealstock..."
APP_TAG=$(aws lightsail push-container-image \
  --region "$REGION" --service-name "$SERVICE" \
  --label app --image mealstock-app \
  | grep -oP '(?<=as "):[^"]+')
echo "    mealstock image: $APP_TAG"

# ── scm-tools ──────────────────────────────────────────────────
echo "==> Building scm-tools..."
docker build -t scm-tools ./scm-tools

echo "==> Pushing scm-tools..."
SCM_TAG=$(aws lightsail push-container-image \
  --region "$REGION" --service-name "$SERVICE" \
  --label scm-tools --image scm-tools \
  | grep -oP '(?<=as "):[^"]+')
echo "    scm-tools image: $SCM_TAG"

# ── update deploy JSON ─────────────────────────────────────────
echo "==> Updating $DEPLOY_JSON..."
python3 - "$DEPLOY_JSON" "$APP_TAG" "$SCM_TAG" <<'EOF'
import sys, json
path, app_tag, scm_tag = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f: d = json.load(f)
d["containers"]["app"]["image"]        = app_tag
d["containers"]["scm-tools"]["image"]  = scm_tag
with open(path, "w") as f: json.dump(d, f, indent=2)
print(f"  app       -> {app_tag}")
print(f"  scm-tools -> {scm_tag}")
EOF

# ── deploy ─────────────────────────────────────────────────────
echo "==> Deploying to Lightsail ($SERVICE)..."
aws lightsail create-container-service-deployment \
  --region "$REGION" --service-name "$SERVICE" \
  --cli-input-json "file://$DEPLOY_JSON"

echo "==> Done. Deployment in progress."
