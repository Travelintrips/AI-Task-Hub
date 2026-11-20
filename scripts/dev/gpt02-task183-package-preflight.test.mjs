import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPackagePreflight} from './gpt02-task183-package-preflight.mjs';
const required=[
 'scripts/dev/gpt02-task183-relock-once.mjs',
 'scripts/dev/gpt02-preparer-relock-host-gate.mjs',
 'artifacts/api-server/package.json',
 'artifacts/api-server/node_modules/pg/package.json',
 'artifacts/api-server/node_modules/pg-pool/package.json',
 'artifacts/api-server/node_modules/pg-protocol/package.json',
 'artifacts/api-server/node_modules/pg-connection-string/package.json',
 'artifacts/api-server/node_modules/pg-types/package.json',
 'artifacts/api-server/node_modules/pgpass/package.json',
 'provenance/pg-only-package-lock.json',
 'artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs',
 'deploy/systemd/gpt02-task183-preparer-relock.service',
 'deploy/systemd/gpt02-task183-preparer-relock.timer'
];
const manifest={source_commit:'a'.repeat(40),files:Object.fromEntries(required.map(x=>[x,{sha256:'b'.repeat(64)}]))};
const sourceFiles=Object.fromEntries(required.map(x=>[x,{exists:true,hashVerified:true}]));
const activeLink={isSymlink:true,matchesManifest:true};
const credential={exists:true,uid:0,mode:0o600,isRegularFile:true};
function check(v){return assessPackagePreflight({manifest,sourceFiles,activeLink,credential,...v})}
test('missing immutable current link is never ready',()=>{
 const r=check({activeLink:{isSymlink:false,matchesManifest:false}});
 assert.equal(r.result,'NO_GO');
 assert.ok(r.reasons.includes('IMMUTABLE_ACTIVE_RUNTIME_LINK_ABSENT_OR_MISMATCHED'));
});
test('missing actual relock pg runtime package is never ready',()=>{
 const files={...sourceFiles,'artifacts/api-server/node_modules/pg/package.json':{exists:false,hashVerified:false}};
 const r=check({sourceFiles:files});assert.equal(r.result,'NO_GO');
 assert.ok(r.reasons.includes('PACKAGE_FILE_MISSING:artifacts/api-server/node_modules/pg/package.json'));
});
test('missing old relock host gate from snapshot is detected',()=>{
 const files={...sourceFiles,'scripts/dev/gpt02-preparer-relock-host-gate.mjs':{exists:false,hashVerified:false}};
 const r=check({sourceFiles:files});assert.equal(r.result,'NO_GO');
});
test('hash mismatch of pinned privileged source causes NO-GO',()=>{
 const files={...sourceFiles,'scripts/dev/gpt02-task183-relock-once.mjs':{exists:true,hashVerified:false}};
 const r=check({sourceFiles:files});assert.equal(r.result,'NO_GO');
 assert.ok(r.reasons.includes('PACKAGE_FILE_UNVERIFIED:scripts/dev/gpt02-task183-relock-once.mjs'));
});
test('credential owned by nonroot or has permissive mode is NO-GO',()=>{
 for(const c of [{...credential,uid:1000},{...credential,mode:0o644},{...credential,isRegularFile:false}]){
  assert.equal(check({credential:c}).result,'NO_GO');
 }
});
test('even complete local package never authorizes hosted role unlock',()=>{
 const r=check({});
 assert.equal(r.result,'PACKAGE_METADATA_PRESENT_NOT_HOSTED_AUTHORITY');
 assert.equal(r.hostedRoleUnlockPermitted,false);
 assert.equal(r.dispatchPermitted,false);
});

test('pg package integrity mismatch or missing offline lock are NO-GO',()=>{
 const untrusted={...sourceFiles,
   'artifacts/api-server/node_modules/pg/package.json':{exists:true,hashVerified:false}};
 assert.ok(check({sourceFiles:untrusted}).reasons.includes(
   'PACKAGE_FILE_UNVERIFIED:artifacts/api-server/node_modules/pg/package.json'));
 const missing={...sourceFiles,
   'provenance/pg-only-package-lock.json':{exists:false,hashVerified:false}};
 assert.equal(check({sourceFiles:missing}).result,'NO_GO');
});
test('transitive pg library without its sha256 fails admission',()=>{
 const lib='artifacts/api-server/node_modules/pg/lib/client.js';
 const r=check({manifest:{...manifest,files:{...manifest.files,
   [lib]:{sha256:'c'.repeat(64)}}}});
 assert.equal(r.result,'NO_GO');
 assert.ok(r.reasons.includes('PACKAGE_DEPENDENCY_UNVERIFIED:'+lib));
});
