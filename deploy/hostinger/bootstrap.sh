#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this bootstrap once as root (or with sudo)." >&2
  exit 1
fi

install -d -m 0750 /etc/ai-task
install -d -m 0755 /opt/ai-task

for target in production development; do
  compose="/etc/ai-task/compose.$target.env"
  appenv="/etc/ai-task/$target.env"

  if [ ! -f "$compose" ]; then
    cp "deploy/hostinger/compose.$target.env.example" "$compose"
    chmod 0640 "$compose"
    echo "Created $compose"
  fi

  if [ ! -f "$appenv" ]; then
    cp "deploy/hostinger/env.$target.example" "$appenv"
    chmod 0600 "$appenv"
    echo "Created $appenv — fill secrets before deploying."
  fi
done

echo
echo "Next:"
echo "1. Fill /etc/ai-task/production.env and /etc/ai-task/development.env"
echo "2. Replace domain placeholders in deploy/hostinger/nginx-ai-task.conf.example"
echo "3. Install/enable the Nginx site and TLS certificates"
echo "4. Run deploy/hostinger/deploy.sh production and development"
