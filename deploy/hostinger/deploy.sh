#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  production)
    BRANCH="main"
    DEFAULT_APP_ROOT="$HOME/apps/ai-task/production"
    DEFAULT_COMPOSE_ENV="/etc/ai-task/compose.production.env"
    ;;
  development)
    BRANCH="develop"
    DEFAULT_APP_ROOT="$HOME/apps/ai-task/development"
    DEFAULT_COMPOSE_ENV="/etc/ai-task/compose.development.env"
    ;;
  *)
    echo "Usage: $0 <production|development>" >&2
    exit 2
    ;;
esac

APP_ROOT="${AI_TASK_APP_ROOT:-$DEFAULT_APP_ROOT}"
COMPOSE_ENV="${AI_TASK_COMPOSE_ENV:-$DEFAULT_COMPOSE_ENV}"
REPO_URL="${AI_TASK_REPO_URL:-https://github.com/Travelintrips/AI-Task-Hub.git}"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

if [ ! -f "$COMPOSE_ENV" ]; then
  echo "Missing compose env: $COMPOSE_ENV" >&2
  exit 1
fi

mkdir -p "$(dirname "$APP_ROOT")"

if [ ! -d "$APP_ROOT/.git" ]; then
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_ROOT"
fi

cd "$APP_ROOT"
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

set -a
. "$COMPOSE_ENV"
set +a

if [ -z "${APP_ENV_FILE:-}" ] || [ ! -f "$APP_ENV_FILE" ]; then
  echo "Missing application env file: ${APP_ENV_FILE:-<unset>}" >&2
  exit 1
fi
if [ -z "${HOST_PORT:-}" ] || [ -z "${CONTAINER_NAME:-}" ]; then
  echo "HOST_PORT and CONTAINER_NAME must be set in $COMPOSE_ENV" >&2
  exit 1
fi

docker compose \
  --env-file "$COMPOSE_ENV" \
  -f deploy/hostinger/docker-compose.yml \
  up -d --build --remove-orphans

for attempt in $(seq 1 45); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    if [ "$TARGET" = "production" ]; then
      echo "Running production database readiness check..."
      if ! docker exec "$CONTAINER_NAME" node -e '
        const { Pool } = require("pg");
        const pool = new Pool({
          connectionString: process.env.SUPABASE_DATABASE_URL,
          ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
        });
        Promise.all([
          pool.query("select 1"),
          pool.query("select 1 from public.conversation_intake_sessions limit 0"),
          pool.query("select 1 from public.admin_notifications limit 0"),
        ]).then(async () => {
          console.log("AI_TASK_DB_READY");
          await pool.end();
        }).catch(async (err) => {
          console.error("AI_TASK_DB_NOT_READY", err.code || err.message);
          try { await pool.end(); } catch {}
          process.exit(1);
        });
      '; then
        echo "Production database readiness check failed" >&2
        docker compose --env-file "$COMPOSE_ENV" -f deploy/hostinger/docker-compose.yml logs --tail=120 app >&2
        exit 1
      fi
    fi
    echo "AI Task Hub $TARGET is healthy on 127.0.0.1:$HOST_PORT"
    docker compose --env-file "$COMPOSE_ENV" -f deploy/hostinger/docker-compose.yml ps
    exit 0
  fi
  if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ]; then
    break
  fi
  sleep 2
done

echo "Health check failed for $TARGET" >&2
docker compose --env-file "$COMPOSE_ENV" -f deploy/hostinger/docker-compose.yml logs --tail=200 app >&2
exit 1
