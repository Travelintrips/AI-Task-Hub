import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAndroidWakeSender } from './wake.mjs';

const jobId = 'e9203104-0938-4f58-9fea-0872b37e12d8';
const args = { deviceId: 'zfold4-paired-dev-04', jobId, token: 'test_device_token_12345' };
test('sends minimal push and deduplicates same job', async () => {
  const events = [];
  const wake = makeAndroidWakeSender({ sendPush: async x => events.push(x) });
  assert.deepEqual(await wake(args), { sent: true, deduplicated: false });
  assert.deepEqual(await wake(args), { sent: false, deduplicated: true });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { type: 'android_job_available', jobId });
});
test('failed transport remains retryable', async () => {
  let tries = 0;
  const wake = makeAndroidWakeSender({ sendPush: async () => { if (++tries === 1) throw Error('unavailable'); } });
  await assert.rejects(wake(args), /unavailable/);
  assert.equal((await wake(args)).sent, true);
});
test('invalid input is rejected', async () => {
  const wake = makeAndroidWakeSender({ sendPush: async () => {} });
  await assert.rejects(wake({ ...args, token: '' }), /invalid_push_token/);
  await assert.rejects(wake({ ...args, deviceId: '../oops' }), /invalid_device_id/);
});
