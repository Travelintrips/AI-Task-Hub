/** Retired: rotating temporary role credentials behind a shared pooler caused
 * failed cached reconnects and a CST-DEV network ban. Never run this live test.
 * Dedicated-role behavior remains covered by the disposable SCRAM fixture.
 */
export const retirement = Object.freeze({
  code: 'LIVE_CREDENTIAL_ROTATION_SMOKE_RETIRED',
  databaseChanges: false,
  networkRequests: false,
  workerDispatch: false,
  reason: 'Shared-pooler cached reconnects can fail after temporary credentials are revoked.',
  replacement: 'scripts/dev/test-gpt02-issuer-store-isolated.sh',
});
console.error(JSON.stringify(retirement));
process.exitCode = 2;
