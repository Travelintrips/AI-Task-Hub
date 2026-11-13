#!/usr/bin/env bash
set -euo pipefail

# Local-only regression: no real git remote, SSH, database, or Docker.
HERE="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$HERE/../.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/deploy/hostinger/deploy.sh"
test -f "$DEPLOY_SCRIPT"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/app/.git"
: > "$tmp/compose.env"

cat > "$tmp/bin/git" <<'GIT'
#!/usr/bin/env bash
if [[ "\${1:-}" == "rev-parse" ]]; then
  printf '%s\n' "\${MOCK_ORIGIN_SHA:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
fi
exit 0
GIT

cat > "$tmp/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
echo 'UNEXPECTED_DOCKER_EXECUTED' >&2
exit 71
DOCKER
chmod +x "$tmp/bin/git" "$tmp/bin/docker"

run_dev() {
  env \
    PATH="$tmp/bin:$PATH" \
    AI_TASK_APP_ROOT="$tmp/app" \
    AI_TASK_COMPOSE_ENV="$tmp/compose.env" \
    AI_TASK_DEV_EXPECTED_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    MOCK_ORIGIN_SHA="$1" \
    bash "$DEPLOY_SCRIPT" development
}

set +e
wrong_output="$(run_dev bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2>&1)"
wrong_status=$?
set -e
[[ "$wrong_status" -ne 0 ]] || { echo 'MISMATCH_SHA_WAS_ACCEPTED' >&2; exit 1; }
grep -q 'DEV_RELEASE_SHA_CHANGED_DURING_DEPLOY' <<<"$wrong_output"
! grep -q 'UNEXPECTED_DOCKER_EXECUTED' <<<"$wrong_output"

set +e
matching_output="$(run_dev aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>&1)"
matching_status=$?
set -e
# Matching SHA must pass both git probes and stop at the next unrelated
# preflight (the fake compose config intentionally has no APP_ENV_FILE).
[[ "$matching_status" -ne 0 ]] || { echo 'MOCK_ENV_UNEXPECTEDLY_SUCCEEDED' >&2; exit 1; }
grep -q 'Missing application env file' <<<"$matching_output"
! grep -q 'DEV_RELEASE_SHA_CHANGED_DURING_DEPLOY' <<<"$matching_output"
! grep -q 'UNEXPECTED_DOCKER_EXECUTED' <<<"$matching_output"

echo 'ISOLATED_DEV_SHA_PIN_PASS: mismatch rejected; match reaches next preflight; zero Docker calls'
