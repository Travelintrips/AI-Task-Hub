# AI Task Hub — Hostinger DEV + PROD

AI Task Hub no longer requires Replit at runtime. Both environments run the same Dockerized application on Hostinger and differ by branch, local port, domain, and runtime environment variables.

## Environment layout

| Environment | Git branch | Local bind | Supabase variables |
| --- | --- | --- | --- |
| Production | main | 127.0.0.1:18080 | SUPABASE_URL, SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| Development | develop | 127.0.0.1:18081 | SUPABASE_URL_DEV, SUPABASE_DATABASE_URL_DEV, SUPABASE_SERVICE_ROLE_KEY_DEV |

The API serves the built React frontend, so each environment needs only one application container.

## One-time Hostinger VPS setup

Requirements: Docker Engine with the Compose plugin, Git, Nginx, and TLS certificates.

1. Clone the repository on the VPS.
2. Run sudo bash deploy/hostinger/bootstrap.sh.
3. Fill /etc/ai-task/production.env with production credentials.
4. Fill /etc/ai-task/development.env with development credentials. Never copy production database or service-role credentials into DEV.
5. Copy deploy/hostinger/nginx-ai-task.conf.example into your Nginx configuration and replace both domain placeholders.
6. Point the production and development DNS A records to the Hostinger VPS.
7. Issue TLS certificates for both domains and reload Nginx.
8. Deploy with:
   - bash deploy/hostinger/deploy.sh production
   - bash deploy/hostinger/deploy.sh development

Health endpoints:
- https://PRODUCTION_DOMAIN/api/healthz
- https://DEVELOPMENT_DOMAIN/api/healthz

## GitHub automatic deployment

Create GitHub Environments named production and development.

In each environment configure these Secrets:
- HOSTINGER_HOST
- HOSTINGER_PORT
- HOSTINGER_USER
- HOSTINGER_SSH_KEY

Optional environment variable:
- HOSTINGER_APP_ROOT

If HOSTINGER_APP_ROOT is omitted, the workflow uses a per-environment directory below the SSH user's home directory.

Deployment behavior:
- push to main -> production
- push to develop -> development
- workflow_dispatch -> select either environment

Application secrets stay on Hostinger in /etc/ai-task/*.env. They are never copied into the Docker image or committed to GitHub.

## Runtime isolation

The server has no database fallback:
- production reads only SUPABASE_DATABASE_URL
- development reads only SUPABASE_DATABASE_URL_DEV

Supabase Storage also selects the production or development project from NODE_ENV. If an expected environment variable is missing, the app will not silently fall back to the other environment.

## Replit removal

The runtime no longer uses Replit deployment configuration, Replit domains, Replit Vite plugins, Replit AI proxying, or the Replit Object Storage sidecar. Task documents are stored and read directly from Supabase Storage.

## Security note

Secrets that were previously committed in .replit must be treated as exposed even after the file is deleted, because Git history retains old commits. Rotate those credentials before production cutover.
