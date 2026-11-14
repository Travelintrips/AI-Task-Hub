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

# Never allow an unpinned development deployment, including direct shell use.
# GitHub Actions performs the independent exact-SHA full-CI proof beforehand;
# this local check is a necessary pin, not a signed proof by itself.
if [ "$TARGET" = "development" ] &&
   [[ ! "${AI_TASK_DEV_EXPECTED_SHA:-}" =~ ^[a-f0-9]{40}$ ]]; then
  echo "DEV_RELEASE_EXPECTED_SHA_REQUIRED" >&2
  exit 1
fi

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

# Development release workflows pin a CI-verified SHA, even if develop moves
# between the initial SSH checkout and this script's own git refresh.
# This is opt-in for DEV; production source checkout remains unchanged.
if [ "$TARGET" = "development" ]; then
  if [ "$(git rev-parse "origin/$BRANCH")" != "$AI_TASK_DEV_EXPECTED_SHA" ]; then
    echo "DEV_RELEASE_SHA_CHANGED_DURING_DEPLOY" >&2
    exit 1
  fi
fi

git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

if [ "$TARGET" = "development" ] &&
   [ "$(git rev-parse HEAD)" != "$AI_TASK_DEV_EXPECTED_SHA" ]; then
  echo "DEV_RELEASE_HEAD_MISMATCH_AFTER_CHECKOUT" >&2
  exit 1
fi

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

COMPOSE_FILES=(-f deploy/hostinger/docker-compose.yml)
if [ "$TARGET" = "development" ] &&
   [ "${GPT02_PUBLIC_TRUST_MOUNT_ENABLED:-false}" = "true" ]; then
  TRUST_OVERRIDE="deploy/hostinger/docker-compose.development.trust.yml"
  TRUST_DIR="${GPT02_PUBLIC_TRUST_DIR_HOST:-/run/credentials/gpt02-dev}"
  TRUST_CONFIG_DIR="${GPT02_PUBLIC_TRUST_CONFIG_DIR_HOST:-/etc/gpt02-dev}"
  if [ ! -f "$TRUST_OVERRIDE" ] ||
     [ ! -d "$TRUST_DIR" ] ||
     [ ! -f "$TRUST_CONFIG_DIR/trust-fingerprints.json" ]; then
    echo "GPT02 DEV public trust mount requested but reviewed public trust is incomplete." >&2
    exit 1
  fi
  COMPOSE_FILES+=(-f "$TRUST_OVERRIDE")
fi

echo "Building AI Task Hub image (bounded to 12 minutes)..."
if ! timeout --foreground --kill-after=30s 12m docker compose \
  --env-file "$COMPOSE_ENV" \
  "${COMPOSE_FILES[@]}" \
  build; then
  echo "Docker build failed or exceeded 12 minutes; keeping the current container untouched." >&2
  docker compose --env-file "$COMPOSE_ENV" "${COMPOSE_FILES[@]}" ps >&2 || true
  exit 1
fi

docker compose \
  --env-file "$COMPOSE_ENV" \
  "${COMPOSE_FILES[@]}" \
  up -d --remove-orphans

# DEV-only private bridge: attach AI Task to the existing AI Core worker network.
# Production is intentionally excluded.
if [ "$TARGET" = "development" ] && docker network inspect ai-core-workers_control >/dev/null 2>&1; then
  docker network connect ai-core-workers_control "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

# DEV-only: restore the private AI Task -> CST WA Gateway link whenever
# Docker Compose recreates the DEV app. This does not enable the gateway,
# create a WhatsApp session, send messages, or touch production containers.
# Link only if explicitly configured and the dedicated DEV helper exists.
if [ "$TARGET" = "development" ] &&
   grep -qx 'AI_CORE_JOB_WA_ENABLED=true' "$APP_ENV_FILE" &&
   [ -f /opt/cst-wa-gateway-dev/deploy/connect-ai-core-dev-private.sh ]; then
  echo "Restoring private AI Task DEV -> WhatsApp Gateway DEV connectivity..."
  if ! bash /opt/cst-wa-gateway-dev/deploy/connect-ai-core-dev-private.sh; then
    echo "WARNING: WhatsApp DEV private link failed; notification delivery is unavailable." >&2
  fi
fi

for attempt in $(seq 1 45); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    if [ "$TARGET" = "production" ]; then
      echo "Running production database readiness check..."
      if ! docker exec "$CONTAINER_NAME" node -e '
        fetch("http://127.0.0.1:8080/api/readyz")
          .then(async (res) => {
            const body = await res.text();
            if (!res.ok) throw new Error("HTTP " + res.status + " " + body);
            console.log("AI_TASK_DB_READY", body);
          })
          .catch((err) => {
            console.error("AI_TASK_DB_NOT_READY", err.message);
            process.exit(1);
          });
      '; then
        echo "Production database readiness check failed" >&2
        docker compose --env-file "$COMPOSE_ENV" "${COMPOSE_FILES[@]}" logs --tail=120 app >&2
        exit 1
      fi
    fi
    # DEV opt-in only: validate the *mounted* public roots inside the running
    # application container before reporting the deployment ready. This never
    # reads private credentials, signs, changes DB state or grants dispatch.
    if [ "$TARGET" = "development" ] &&
       [ "${GPT02_PUBLIC_TRUST_MOUNT_ENABLED:-false}" = "true" ]; then
      if ! docker exec -i "$CONTAINER_NAME" node - <<'GPT02_TRUST_VERIFY_JS'
const fs = require("node:fs");
const crypto = require("node:crypto");
const root = "/run/credentials/gpt02-dev";
const manifestPath = "/etc/gpt02-dev/trust-fingerprints.json";
const names = {
  approval: "approval-public.pem",
  hub: "hub-identity-public.pem",
  core: "core-identity-public.pem",
  issuer: "issuer-public.pem",
};
const deny = (code) => { throw Error(code); };
try {
  const dir = fs.lstatSync(root);
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid() ||
      (dir.mode & 0o077) !== 0) deny("PUBLIC_TRUST_DIRECTORY_UNSAFE");
  const files = fs.readdirSync(root).sort();
  const expected = Object.values(names).sort();
  if (JSON.stringify(files) !== JSON.stringify(expected))
    deny("PUBLIC_TRUST_UNEXPECTED_FILES");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() ||
      manifestStat.uid !== 0 || manifestStat.nlink !== 1 ||
      (manifestStat.mode & 0o022) !== 0)
    deny("PUBLIC_TRUST_MANIFEST_UNSAFE");
  const pins = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const roles = Object.keys(names);
  if (!pins || Array.isArray(pins) ||
      JSON.stringify(Object.keys(pins).sort()) !== JSON.stringify([...roles].sort()))
    deny("PUBLIC_TRUST_MANIFEST_INVALID");
  const fingerprints = [];
  for (const role of roles) {
    const path = `${root}/${names[role]}`;
    const stat = fs.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        stat.uid !== process.getuid() || (stat.mode & 0o177) !== 0)
      deny("PUBLIC_TRUST_KEY_FILE_UNSAFE");
    const key = crypto.createPublicKey(fs.readFileSync(path, "utf8"));
    if (key.asymmetricKeyType !== "ed25519") deny("PUBLIC_TRUST_NOT_ED25519");
    const digest = crypto.createHash("sha256")
      .update(key.export({ format: "der", type: "spki" })).digest("hex");
    if (typeof pins[role] !== "string" || pins[role] !== digest)
      deny("PUBLIC_TRUST_FINGERPRINT_MISMATCH");
    fingerprints.push(digest);
  }
  if (new Set(fingerprints).size !== 4) deny("PUBLIC_TRUST_KEYS_NOT_INDEPENDENT");
  console.log("GPT02_DEV_PUBLIC_TRUST_VERIFIED_FOUR_ROOTS_NO_DISPATCH");
} catch (err) {
  console.error("GPT02_DEV_PUBLIC_TRUST_FAILED:" + (err.code || err.message));
  process.exitCode = 2;
}
GPT02_TRUST_VERIFY_JS
      then
        echo "GPT02 DEV public trust verification failed; deployment remains NO-GO." >&2
        exit 1
      fi
    fi

    echo "AI Task Hub $TARGET is healthy on 127.0.0.1:$HOST_PORT"
    docker compose --env-file "$COMPOSE_ENV" "${COMPOSE_FILES[@]}" ps
    exit 0
  fi
  if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ]; then
    break
  fi
  sleep 2
done

echo "Health check failed for $TARGET" >&2
docker compose --env-file "$COMPOSE_ENV" "${COMPOSE_FILES[@]}" logs --tail=200 app >&2
exit 1
