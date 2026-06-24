# Container Environment Variables

Set these in the Lightsail console when creating/updating the `scm-tools` container deployment.

## Required — Core

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Must be `production` for secure cookies | `production` |
| `PLAYWRIGHT_HEADLESS` | Must be `true` in container | `true` |
| `DASHBOARD_PASSWORD` | Dashboard login password | `changeme` |
| `SESSION_SECRET` | Express session signing secret — long random string | `abc123...` |
| `APP_BASE_URL` | Public URL of this deployment | `https://tools.example.org` |

## Required — SCM Login

| Variable | Description |
|---|---|
| `SCM_USERNAME` | SCM account email address |
| `SCM_PASSWORD` | SCM account password |

## Optional — Minutes Sync (SSH)

| Variable | Description |
|---|---|
| `SSH_PRIVATE_KEY` | Base64-encoded SSH private key: `base64 -w0 < key.pem` |
| `SSH_HOST` | Remote server hostname |
| `SSH_USER` | Remote SSH username |
| `MINUTES_REMOTE_PATH` | Absolute path on remote server for minutes files |
| `MINUTES_PUBLIC_URL_BASE` | Public base URL where minutes are served |
| `MINUTES_SCM_PAGE_URL` | SCM minutes page URL |

## Optional — Email (Invite Flow)

| Variable | Description | Default |
|---|---|---|
| `SMTP_HOST` | SMTP server hostname | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `SMTP_FROM` | From address | `SMTP_USER` |

## Optional — StackCP FTP

| Variable | Description | Default |
|---|---|---|
| `STACKCP_URL` | StackCP panel URL | — |
| `STACKCP_USER` | StackCP username | — |
| `STACKCP_PASS` | StackCP password | — |
| `ALERT_EMAIL` | Email address for FTP alerts | — |
| `FTP_CRON` | Cron schedule for FTP unlock job | `0 8 * * 1` |

## Nginx Upstream Config

Add this to your Nginx container config to proxy to the Node app.
Lightsail resolves container names as DNS within the same service.

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
