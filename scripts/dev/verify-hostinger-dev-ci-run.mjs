// Fail-closed release preflight for the Hostinger DEVELOPMENT deployment only.
// No mutation, deployment, GitHub token persistence, or production access.
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'Travelintrips/AI-Task-Hub';
const WORKFLOW_NAME = 'AI Task DEV Verify';
const WORKFLOW_PATH = '.github/workflows/dev-verify.yml';
const REQUIRED_JOB = 'AI Task DEV test, typecheck, build';

export function classifyFullDevRun(payload, { sha, repo = REPOSITORY }) {
  if (!payload || !Array.isArray(payload.workflow_runs)) {
    throw new Error('DEV_VERIFY_API_RESPONSE_INVALID');
  }
  const candidates = payload.workflow_runs.filter((run) =>
    run?.head_sha === sha &&
    run?.head_branch === 'develop' &&
    run?.event === 'push' &&
    run?.name === WORKFLOW_NAME &&
    run?.path === WORKFLOW_PATH &&
    run?.head_repository?.full_name === repo
  );
  if (candidates.length === 0) return { kind: 'wait', code: 'EXACT_SHA_PUSH_RUN_MISSING' };
  candidates.sort((a, b) =>
    (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0) ||
    Number(b.id || 0) - Number(a.id || 0)
  );
  const latest = candidates[0];
  if (latest.status !== 'completed') return { kind: 'wait', code: 'DEV_VERIFY_STILL_RUNNING' };
  if (latest.conclusion !== 'success') {
    return { kind: 'fail', code: 'DEV_VERIFY_' + String(latest.conclusion ?? 'INDETERMINATE').toUpperCase() };
  }
  if (!Number.isSafeInteger(latest.id) || latest.id <= 0) {
    throw new Error('DEV_VERIFY_RUN_ID_INVALID');
  }
  return { kind: 'check_jobs', runId: latest.id };
}

export function assertFullDevJobPassed(payload) {
  if (!payload || !Array.isArray(payload.jobs)) {
    throw new Error('DEV_VERIFY_JOBS_RESPONSE_INVALID');
  }
  const matches = payload.jobs.filter((job) => job?.name === REQUIRED_JOB);
  if (matches.length !== 1 ||
      matches[0].status !== 'completed' ||
      matches[0].conclusion !== 'success') {
    throw new Error('FULL_DEV_VERIFY_JOB_NOT_SUCCESSFUL');
  }
  return true;
}

export async function requireFullDevRun({
  env = process.env,
  fetchFn = globalThis.fetch,
  sleepFn = sleep,
  maxAttempts = 60,
  intervalMs = 15000,
} = {}) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_REF: ref, GITHUB_SHA: sha } = env;
  // A workflow_dispatch can target another branch. Never deploy it as DEV.
  if (repo !== REPOSITORY || ref !== 'refs/heads/develop' || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
    throw new Error('DEV_RELEASE_REPOSITORY_REF_OR_SHA_MISMATCH');
  }
  if (!token) throw new Error('DEV_RELEASE_GITHUB_TOKEN_MISSING');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('INVALID_RETRY_COUNT');
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const base = 'https://api.github.com/repos/' + repo;
  const queryUrl = base + '/actions/workflows/dev-verify.yml/runs' +
    '?branch=develop&event=push&head_sha=' + sha + '&per_page=100';
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetchFn(queryUrl, { headers });
    if (!response.ok) throw new Error('DEV_VERIFY_API_HTTP_' + response.status);
    const state = classifyFullDevRun(await response.json(), { sha, repo });
    if (state.kind === 'fail') throw new Error(state.code);
    if (state.kind === 'check_jobs') {
      const jobsUrl = base + '/actions/runs/' + state.runId + '/jobs?filter=latest&per_page=100';
      const jobsResponse = await fetchFn(jobsUrl, { headers });
      if (!jobsResponse.ok) throw new Error('DEV_VERIFY_JOBS_API_HTTP_' + jobsResponse.status);
      assertFullDevJobPassed(await jobsResponse.json());
      return { verifiedRunId: state.runId, sha };
    }
    if (i < maxAttempts - 1) await sleepFn(intervalMs);
  }
  throw new Error('DEV_VERIFY_EXACT_SHA_NOT_SUCCESSFUL_BEFORE_TIMEOUT');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireFullDevRun()
    .then(({ verifiedRunId, sha }) => {
      console.log('DEV_RELEASE_FULL_VERIFY_PASS run_id=' + verifiedRunId + ' sha=' + sha);
    })
    .catch((error) => {
      console.error('::error::DEV_RELEASE_BLOCKED ' + error.message);
      process.exitCode = 1;
    });
}
