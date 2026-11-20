import test from 'node:test';
import assert from 'node:assert/strict';
import {CREDENTIAL_DIR,assessPreparerContainerBoundary} from './gpt02-preparer-container-preflight.mjs';

const mounted=[{Destination:CREDENTIAL_DIR,RW:false}];
test('current non-root Docker without mount is NO-GO',()=>{
  const r=assessPreparerContainerBoundary({processUid:1000,mounts:[],credentialDirPresent:false});
  assert.equal(r.ready,false);assert.equal(r.dispatchPermitted,false);
  assert.ok(r.reasons.includes('CREDENTIAL_DIRECTORY_NOT_MOUNTED'));
  assert.ok(r.reasons.includes('ROOT_ONLY_CREDENTIAL_UNREADABLE_BY_CONTAINER_USER'));
});
test('adding only a read-only bind mount does not solve root:root identity mismatch',()=>{
  const r=assessPreparerContainerBoundary({processUid:1000,mounts:mounted,credentialDirPresent:true});
  assert.equal(r.ready,false);
  assert.ok(r.reasons.includes('DEDICATED_CREDENTIAL_CONSUMER_NOT_ATTESTED'));
});
test('running full application as root is not an acceptable bypass',()=>{
  const r=assessPreparerContainerBoundary({processUid:0,mounts:mounted,credentialDirPresent:true});
  assert.equal(r.ready,false);
  assert.ok(r.reasons.includes('ROOT_APPLICATION_NOT_PERMITTED_AS_WORKAROUND'));
});
test('writable bind mount and feature enabled are each NO-GO',()=>{
  const r=assessPreparerContainerBoundary({processUid:1000,mounts:[{Destination:CREDENTIAL_DIR,RW:true}],credentialDirPresent:true,featureEnabled:true,dedicatedConsumer:true});
  assert.equal(r.ready,false);assert.ok(r.reasons.includes('CREDENTIAL_MOUNT_NOT_READ_ONLY'));
  assert.ok(r.reasons.includes('PREPARATION_FLAG_MUST_REMAIN_DISABLED'));
});
test('dedicated consumer is necessary but does not authorize dispatch',()=>{
  const r=assessPreparerContainerBoundary({processUid:1000,mounts:mounted,credentialDirPresent:true,dedicatedConsumer:true});
  assert.equal(r.ready,true);assert.equal(r.dispatchPermitted,false);
});
