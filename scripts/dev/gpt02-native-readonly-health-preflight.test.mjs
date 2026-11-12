import {test} from "node:test";
import assert from "node:assert/strict";
import {runNativeReadOnlyPreflight} from "./gpt02-native-readonly-health-preflight.mjs";

const roles=["approval","hub","core","issuer"];
const hub={ok:true,environment:"DEV",readerReady:true,hubRole:"gpt02_hub_evidence_reader",
 coreRole:"gpt02_core_evidence_reader",twoSessionsVerified:true,signingPermitted:false,dispatchPermitted:false};
const issuer={ok:true,environment:"DEV",readerReady:true,issuerRole:"gpt02_issuer_evidence_reader",
 tlsVerified:true,readOnly:true,signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,releaseDecision:"NO_GO"};
const signer=role=>({environment:"DEV",role,fingerprintMatched:true,hubCoreReaderOperational:true,
 issuerReaderOperational:true,trustedReaderConnectivityVerified:true,privateCredentialMounted:true,
 signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,releaseDecision:"NO_GO"});
const run=(opts={})=>runNativeReadOnlyPreflight({
 taskId:149,hubHealth:async()=>hub,issuerHealth:async()=>issuer,signerReadiness:async r=>signer(r),...opts
});

test("independent healthy readers and four signers still NEVER authorize GPT02",async()=>{
 const v=await run();
 assert.equal(v.independentReaderHealthVerified,true);
 assert.equal(v.signersRestrictedAndHealthy,true);
 assert.deepEqual(Object.keys(v.signers),roles);
 assert.equal(v.releaseDecision,"NO_GO");
 for(const f of ["authorizationGranted","dispatchPermitted","signingPermitted",
    "taskBoundOperatorSignatureVerified","immutableAttemptBound",
    "issuerNonceConsumed","issuerLeaseVerified"]) assert.equal(v[f],false);
});
test("reject task 135/136 and any non-DEV environment without contacting readers",async()=>{
 for(const id of [0,135,136,NaN,"149"]) await assert.rejects(run({taskId:id}),/NEW_TASK_REQUIRED/);
 for(const opts of [{environment:"production"},{appEnv:"production"},{environment:"test"}]) {
  await assert.rejects(run(opts),/EXPLICIT_DEV_ONLY/);
 }
});
test("wrong Hub role or unverified second session fails closed",async()=>{
 for(const field of ["hubRole","coreRole","twoSessionsVerified"]) {
  const bad={...hub,[field]:null};
  const v=await run({hubHealth:async()=>bad});
  assert.equal(v.hubReaderVerified,false);
  assert.equal(v.independentReaderHealthVerified,false);
  assert.equal(v.dispatchPermitted,false);
 }
});
test("issuer can never be elevated into health by a forged green claim",async()=>{
 const v=await run({issuerHealth:async()=>({...issuer,dispatchPermitted:true})});
 assert.equal(v.issuerReaderVerified,false);assert.equal(v.releaseDecision,"NO_GO");
});
test("any signer claim changing to signingPermitted=true fails closed",async()=>{
 const v=await run({signerReadiness:async r=>r==="approval"?{...signer(r),signingPermitted:true}:signer(r)});
 assert.equal(v.signersRestrictedAndHealthy,false);
 assert.equal(v.signers.approval,false);
 assert.equal(v.authorizationGranted,false);
});
test("missing socket, unreadable readiness or malformed sources remain NO_GO",async()=>{
 const v=await run({hubHealth:async()=>{throw Error("ECONNREFUSED")},
  signerReadiness:async r=>r==="issuer"?null:signer(r)});
 assert.equal(v.hubReaderVerified,false);
 assert.equal(v.signers.issuer,false);
 assert.equal(v.releaseDecision,"NO_GO");
});
