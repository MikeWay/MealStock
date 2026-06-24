#!/usr/bin/env bash
set -euo pipefail

SERVER="bitnami@ribmanager.exe-sailing-club.org"
SSH_KEY="${HOME}/.ssh/LightsailDefaultKey-eu-west-2.pem"
REMOTE_DIR="~/scm-tools"
SSH="ssh -i ${SSH_KEY}"
SCP_OPTS="-i ${SSH_KEY}"

echo "==> Building..."
npm run build

echo "==> Syncing files..."
rsync -az --delete \
  -e "ssh -i ${SSH_KEY}" \
  dist/ \
  "${SERVER}:${REMOTE_DIR}/dist/"

rsync -az \
  -e "ssh -i ${SSH_KEY}" \
  package.json package-lock.json \
  "${SERVER}:${REMOTE_DIR}/"

echo "==> Installing dependencies (if needed)..."
${SSH} "${SERVER}" "cd ${REMOTE_DIR} && npm ci --omit=dev --ignore-scripts 2>&1 | tail -5"

echo "==> Restarting service..."
${SSH} "${SERVER}" "sudo systemctl restart scm-tools"

echo "==> Done."
