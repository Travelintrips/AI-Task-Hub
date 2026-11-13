import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { classifyFullDevRun, assertFullDevJobPassed, requireFullDevRun } from './verify-hostinger-dev-ci-run.mjs';

const sha = 'a'.repeat(40);
const repo = 'Travelintrips/AI-Task-Hub';
const env = {
  GITHUB_TOKEN: 'test-only-placeholder',
  GITHUB_REPOSITORY: repo,
  GITHUB_REF: 'refs/heads/develop',
  GITHUB_SHA: sha,
};
const correctRun = (changes = {}) => ({
  id: 51, head_sha: sha, head_branch: 'develop', event: 'push',
  name: 'AI Task DEV Verify', path: '.github/workflows/dev-verify.yml',
  head_repository: { full_name: repo },
  status: 'completed', conclusion: 'success',
  created_at: '2026-11-14T00:00:00Z', ...changes,
});
const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const goodJob = {
  jobs: [{ name: 'AI Task DEV test, typecheck, build', status: 'completed', conclusion: 'success' }],
};
function stub(runResponse, jobsResponse = goodJob) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return url.includes('/actions/runs/51/jobs')
      ? reply(jobsResponse)
      : reply(runResponse);
  };
  return { calls, fetchFn };
}

test('exact develop push SHA + trusted workflow + full verification job passes', async () => {
  const s = stub({ workflow_runs: [correctRun()] });
  const result = await requireFullDevRun({ env, fetchFn: s.fetchFn, maxAttempts: 1 });
  assert.equal(result.verifiedRunId, 51);
  assert.equal(result.sha, sha);
  assert.equal(s.calls.length, 2);
  assert.match(s.calls[0].url, /head_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(s.calls[1].url, /actions\/runs\/51\/jobs/);
});

test('rejects incorrect SHA, tenant repository, PR event, wrong workflow or branch', () => {
  for (const variant of [
    { head_sha: 'b'.repeat(40) },
    { head_repository: { full_name: 'Other/Repo' } },
    { event: 'pull_request' },
    { name: 'Lightweight verify' },
    { path: '.github/workflows/hostinger-deploy.yml' },
    { head_branch: 'main' },
  ]) {
    assert.equal(
      classifyFullDevRun({ workflow_runs: [correctRun(variant)] }, { sha }).kind,
      'wait'
    );
  }
});

test('selects latest exact SHA run and rejects failed re-run', () => {
  const result = classifyFullDevRun({ workflow_runs: [
    correctRun({ id: 50, created_at: '2026-11-13T23:00:00Z' }),
    correctRun({ id: 52, conclusion: 'failure', created_at: '2026-11-14T00:01:00Z' }),
  ] }, { sha });
  assert.equal(result.kind, 'fail');
  assert.equal(result.code, 'DEV_VERIFY_FAILURE');
});

test('requires completed SUCCESS, does not treat skipped/neutral/cancelled as success', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null]) {
    assert.equal(
      classifyFullDevRun({ workflow_runs: [correctRun({ conclusion })] }, { sha }).kind,
      'fail'
    );
  }
  assert.equal(
    classifyFullDevRun({ workflow_runs: [correctRun({ status: 'in_progress', conclusion: null })] }, { sha }).kind,
    'wait'
  );
});

test('full DEV job must really be complete and successful', () => {
  assert.equal(assertFullDevJobPassed(goodJob), true);
  for (const malformed of [
    { jobs: [] },
    { jobs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] },
    { jobs: [{ ...goodJob.jobs[0], conclusion: 'skipped' }] },
    { jobs: [{ ...goodJob.jobs[0], status: 'in_progress', conclusion: null }] },
    { jobs: [goodJob.jobs[0], goodJob.jobs[0]] },
  ]) {
    assert.throws(() => assertFullDevJobPassed(malformed), /FULL_DEV_VERIFY_JOB_NOT_SUCCESSFUL/);
  }
});

test('fail closed on no exact SHA run after bounded wait', async () => {
  await assert.rejects(
    requireFullDevRun({ env, fetchFn: async () => reply({ workflow_runs: [] }), maxAttempts: 1 }),
    /DEV_VERIFY_EXACT_SHA_NOT_SUCCESSFUL_BEFORE_TIMEOUT/
  );
});

test('blocks manual deployment on main, wrong repo or missing token before HTTP request', async () => {
  for (const badEnv of [
    { ...env, GITHUB_REF: 'refs/heads/main' },
    { ...env, GITHUB_REPOSITORY: 'Other/Repo' },
    { ...env, GITHUB_SHA: 'not-a-sha' },
    { ...env, GITHUB_TOKEN: '' },
  ]) {
    await assert.rejects(
      requireFullDevRun({ env: badEnv, fetchFn: async () => { throw Error('MUST_NOT_FETCH'); }, maxAttempts: 1 }),
      /DEV_RELEASE_/
    );
  }
});

test('rejects HTTP authorization or API errors without treating them as verification', async () => {
  await assert.rejects(
    requireFullDevRun({ env, fetchFn: async () => reply({}, 403), maxAttempts: 1 }),
    /DEV_VERIFY_API_HTTP_403/
  );
  await assert.rejects(
    requireFullDevRun({
      env,
      fetchFn: async (url) => url.includes('/jobs') ? reply({}, 404) : reply({ workflow_runs: [correctRun()] }),
      maxAttempts: 1,
    }),
    /DEV_VERIFY_JOBS_API_HTTP_404/
  );
});

test('waits for the real full run rather than trusting earlier lightweight green checks', async () => {
  let count = 0;
  let slept = 0;
  const result = await requireFullDevRun({
    env, maxAttempts: 3,
    fetchFn: async (url) => {
      if (url.includes('/jobs')) return reply(goodJob);
      count++;
      return reply({ workflow_runs: [correctRun({
        status: count < 3 ? 'in_progress' : 'completed',
        conclusion: count < 3 ? null : 'success',
      })] });
    },
    sleepFn: async () => { slept++; },
  });
  assert.equal(result.verifiedRunId, 51);
  assert.equal(count, 3);
  assert.equal(slept, 2);
});

test('Hostinger DEV deployment must preserve exact SHA across both git fetches', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/hostinger-deploy.yml', import.meta.url), 'utf8'
  );
  const deploy = await readFile(
    new URL('../../deploy/hostinger/deploy.sh', import.meta.url), 'utf8'
  );
  const development = workflow.split('\n  deploy-development:\n')[1];
  const production = workflow.split('\n  deploy-production:\n')[1]
    .split('\n  dev-ci-release-gate:\n')[0];
  assert.ok(development, 'missing development deploy job');
  assert.ok(production, 'missing production deploy job');
  assert.match(development, /needs: \[verify, dev-ci-release-gate\]/);
  assert.match(development, /EXPECTED_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(development, /DEV_RELEASE_SHA_CHANGED/);
  assert.match(development, /DEV_RELEASE_HEAD_MISMATCH/);
  assert.match(development, /AI_TASK_DEV_EXPECTED_SHA=/);
  assert.match(development, /git reset --hard/);
  assert.match(deploy, /DEV_RELEASE_EXPECTED_SHA_REQUIRED/);
  assert.match(deploy, /AI_TASK_DEV_EXPECTED_SHA:-/);
  assert.match(deploy, /DEV_RELEASE_SHA_CHANGED_DURING_DEPLOY/);
  assert.match(deploy, /DEV_RELEASE_HEAD_MISMATCH_AFTER_CHECKOUT/);
  assert.doesNotMatch(production, /EXPECTED_SHA|AI_TASK_DEV_EXPECTED_SHA|dev-ci-release-gate/);
});
