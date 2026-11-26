#!/usr/bin/env bash
set -euo pipefail

# Local-only regression: no real git remote, SSH, database, or Docker.
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$HERE/../.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/deploy/hostinger/deploy.sh"
test -f "$DEPLOY_SCRIPT"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/app/.git"
: > "$tmp/compose.env"

cat > "$tmp/bin/git" <<'GIT'
#!/usr/bin/env bash
if [[ "${1:-}" == "status" ]]; then
  if [[ "${MOCK_DEV_DIRTY:-false}" == true ]]; then
    printf ' M local-dev-changes\n'
  fi
elif [[ "${1:-}" == "checkout" || "${1:-}" == "reset" ]]; then
  echo 'GIT_MUTATION_REACHED' >&2
elif [[ "${1:-}" == "rev-parse" ]]; then
  printf '%s\n' "${MOCK_ORIGIN_SHA:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
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
    MOCK_DEV_DIRTY="${2:-false}" \
    bash "$DEPLOY_SCRIPT" development
}

# A direct DEV invocation without a verified SHA must fail before git/Docker.
set +e
missing_output="$(env -u AI_TASK_DEV_EXPECTED_SHA PATH="$tmp/bin:$PATH" AI_TASK_APP_ROOT="$tmp/app" AI_TASK_COMPOSE_ENV="$tmp/compose.env" bash "$DEPLOY_SCRIPT" development 2>&1)"
missing_status=$?
bad_output="$(env PATH="$tmp/bin:$PATH" AI_TASK_APP_ROOT="$tmp/app" AI_TASK_COMPOSE_ENV="$tmp/compose.env" AI_TASK_DEV_EXPECTED_SHA="not-a-valid-sha" bash "$DEPLOY_SCRIPT" development 2>&1)"
bad_status=$?
set -e
[[ "$missing_status" -ne 0 && "$bad_status" -ne 0 ]] || { echo 'DEV_SHA_MISSING_OR_INVALID_ACCEPTED' >&2; exit 1; }
grep -q 'DEV_RELEASE_EXPECTED_SHA_REQUIRED' <<<"$missing_output"
grep -q 'DEV_RELEASE_EXPECTED_SHA_REQUIRED' <<<"$bad_output"
! grep -q 'UNEXPECTED_DOCKER_EXECUTED' <<<"$missing_output"
! grep -q 'UNEXPECTED_DOCKER_EXECUTED' <<<"$bad_output"

# Dirty checkout must fail before git checkout/reset even with a valid SHA.
set +e
dirty_output="$(run_dev aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa true 2>&1)"
dirty_status=$?
set -e
[[ "$dirty_status" -ne 0 ]] || { echo 'DIRTY_DEV_CHECKOUT_ACCEPTED' >&2; exit 1; }
grep -q 'DEV_RELEASE_DIRTY_WORKTREE_BLOCKED' <<<"$dirty_output"
! grep -q 'GIT_MUTATION_REACHED' <<<"$dirty_output"
! grep -q 'UNEXPECTED_DOCKER_EXECUTED' <<<"$dirty_output"

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

echo 'ISOLATED_DEV_SHA_PIN_PASS: missing/invalid SHA and mismatch rejected; match reaches next preflight; zero Docker calls'
