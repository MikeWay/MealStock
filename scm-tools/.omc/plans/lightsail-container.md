# Plan: Package scm-tools as a Lightsail Container

## Requirements Summary

- Package the Express/Playwright Node.js app as a Docker container
- Deploy as a second container alongside the existing Nginx reverse proxy on the Lightsail Container Service
- Nginx proxies to the Node app; the Node app serves both API and static frontend
- State (`.auth/`, `.cache/`) is ephemeral — lost on restart is acceptable
- SSH private key for minutes feature injected at runtime via environment variable
- All secrets passed as Lightsail environment variables (not baked into image)

## Acceptance Criteria

1. `docker build -t scm-tools .` succeeds from the repo root
2. `docker run --env-file .env -p 3000:3000 scm-tools` starts and `GET /api/health` returns `{"status":"ok"}`
3. Playwright launches headless Chromium inside the container without errors
4. `.auth/` and `.cache/` directories are created automatically on first write (already handled by app code)
5. SSH private key passed as `SSH_PRIVATE_KEY` env var (base64) is written to `/tmp/ssh_key` by entrypoint and `SSH_KEY_PATH` is set correctly
6. Nginx container proxies traffic to the Node container by container name
7. All required environment variables are documented in `container-env.md`

## Implementation Steps

### Step 1 — Create `.dockerignore` (`/.dockerignore`)

Exclude dev artifacts, secrets, and local state from the image:
```
node_modules
dist
.auth
.cache
.env
*.pem
src
tsconfig.json
deploy.sh
.omc
.claude
```

### Step 2 — Create multi-stage `Dockerfile` (`/Dockerfile`)

**Build stage:** compile TypeScript  
**Runtime stage:** production deps + Playwright Chromium only

```dockerfile
# ── Build stage ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# System deps for Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
    ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Install only Chromium browser binaries
RUN npx playwright install chromium

COPY --from=builder /app/dist/ ./dist/

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
```

### Step 3 — Create `entrypoint.sh` (`/entrypoint.sh`)

Writes the SSH private key from env var to a temp file before starting the server:

```bash
#!/bin/sh
set -e

if [ -n "$SSH_PRIVATE_KEY" ]; then
  echo "$SSH_PRIVATE_KEY" | base64 -d > /tmp/ssh_key
  chmod 600 /tmp/ssh_key
  export SSH_KEY_PATH=/tmp/ssh_key
fi

exec node dist/server.js
```

### Step 4 — Update Nginx container config

The existing Nginx container needs an upstream block pointing to the Node app by its Lightsail container name (e.g. `scm-tools`). Lightsail sets up DNS between containers in the same service using container names.

Add to Nginx config:
```nginx
upstream scm_tools {
    server scm-tools:3000;
}

server {
    listen 80;

    location / {
        proxy_pass http://scm_tools;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Required for SSE (auto-merge streaming endpoint)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

> Note: SSE buffering must be disabled — `/api/contacts/auto-merge/run` uses SSE streaming.

### Step 5 — Document environment variables (`/container-env.md`)

Document all env vars needed for the Lightsail deployment console. Group by feature so they can be set selectively:

**Required — core:**
| Variable | Description |
|---|---|
| `DASHBOARD_PASSWORD` | Dashboard login password |
| `SESSION_SECRET` | Express session signing secret (random, long) |
| `NODE_ENV` | Set to `production` |
| `PLAYWRIGHT_HEADLESS` | Set to `true` |
| `APP_BASE_URL` | Public URL, e.g. `https://tools.example.org` |

**Required — SCM login:**
| Variable | Description |
|---|---|
| `SCM_USERNAME` | SCM account email |
| `SCM_PASSWORD` | SCM account password |

**Optional — minutes sync (SSH):**
| Variable | Description |
|---|---|
| `SSH_PRIVATE_KEY` | Base64-encoded SSH private key (`base64 -w0 < key.pem`) |
| `SSH_HOST` | Remote server hostname |
| `SSH_USER` | Remote SSH username |
| `MINUTES_REMOTE_PATH` | Remote path for minutes files |
| `MINUTES_PUBLIC_URL_BASE` | Public base URL for minutes |
| `MINUTES_SCM_PAGE_URL` | SCM minutes page URL |

**Optional — email (invite flow):**
| Variable | Description |
|---|---|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (default 587) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From address (defaults to SMTP_USER) |

**Optional — StackCP FTP:**
| Variable | Description |
|---|---|
| `STACKCP_URL` | StackCP panel URL |
| `STACKCP_USER` | StackCP username |
| `STACKCP_PASS` | StackCP password |
| `ALERT_EMAIL` | Email for FTP alerts |
| `FTP_CRON` | Cron schedule (default `0 8 * * 1`) |

### Step 6 — Create `deploy-container.sh` (`/deploy-container.sh`)

Script to build, push, and deploy to Lightsail:

```bash
#!/usr/bin/env bash
set -euo pipefail

SERVICE="your-lightsail-service-name"  # ← update this
LABEL="scm-tools"

echo "==> Building image..."
docker build -t scm-tools .

echo "==> Pushing to Lightsail..."
aws lightsail push-container-image \
  --service-name "$SERVICE" \
  --label "$LABEL" \
  --image scm-tools

echo "==> Image pushed. Deploy via Lightsail console or update containers.json and run:"
echo "    aws lightsail create-container-service-deployment --service-name $SERVICE ..."
```

> Full deployment via CLI requires a `containers.json` referencing the pushed image digest (printed by push-container-image). Easier to trigger the deployment from the Lightsail console after push.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Playwright Chromium apt deps are incomplete | Test with `docker run --rm scm-tools node -e "const {chromium} = require('playwright'); chromium.launch().then(b => { console.log('OK'); b.close(); })"` during step verification |
| Image size too large for Lightsail pulls | Use `--omit=dev` + only install Chromium (not Firefox/WebKit); ~800MB expected |
| SSH key newlines corrupted in Lightsail env vars | Base64-encode the key before storing; entrypoint decodes with `base64 -d` |
| Session cookies don't work behind Nginx | `NODE_ENV=production` sets `secure: true`; Nginx must forward `X-Forwarded-Proto` header |
| SSE streaming blocked by Nginx buffering | `proxy_buffering off` + `proxy_cache off` in Nginx location block |
| `.auth/` lost on restart = users need to re-login to SCM | Document this as expected behaviour; SCM re-login is quick |

## Verification Steps

1. `docker build -t scm-tools .` — succeeds with no errors
2. `docker run --env-file .env -p 3000:3000 scm-tools` — server starts, logs show port 3000
3. `curl localhost:3000/api/health` — returns `{"status":"ok"}`
4. Open `http://localhost:3000` — login page loads
5. Log in to dashboard, trigger a contact sync — verifies Playwright/Chromium works
6. After deploying to Lightsail: confirm Nginx proxies correctly via the public URL
7. Test SSE endpoint: `curl -N https://your-domain/api/contacts/auto-merge/run` should stream events
