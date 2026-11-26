// Run the release module's own SQL as the fixture's real auditor login.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const [modulePath, container, expected] = process.argv.slice(2);
const {relockTask183WithExistingAuditor} = await import(pathToFileURL(modulePath));
let calls = 0;
const client = {
  async query({text}) {
    calls++;
    const output = execFileSync('docker', ['exec', '-i', container, 'psql',
      '-XAtq', '-U', 'dev_gpt02_relock_catalog_auditor', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      {input: `SELECT row_to_json(r) FROM (${text}) r;`, encoding: 'utf8'});
    return {rows: output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))};
  },
};
if (expected === 'denied') {
  await assert.rejects(relockTask183WithExistingAuditor(client),
    {message: 'RELOCK_TASK183_UNVERIFIED_SCOPE_OR_GRANT'});
  assert.equal(calls, 1);
} else {
  assert.equal(expected, 'locked');
  const result = await relockTask183WithExistingAuditor(client);
  assert.deepEqual(result, {roleLocked:true, sessionsTerminated:0, sessionsRemaining:0,
    canaryActive:false, operationalActive:false, dispatchPermitted:false, preparationAttempted:false});
  assert.equal(calls, 2);
}
