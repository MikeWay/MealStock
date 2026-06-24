#!/bin/sh
set -e

if [ -n "$SSH_PRIVATE_KEY" ]; then
  echo "$SSH_PRIVATE_KEY" | base64 -d > /tmp/ssh_key
  chmod 600 /tmp/ssh_key
  export SSH_KEY_PATH=/tmp/ssh_key
fi

exec node dist/server.js
