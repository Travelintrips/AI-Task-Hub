import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {reviewOneJobCrossRepoFinalAck}
  from "../../artifacts/api-server/src/lib/cst-team-onejob-cross-repo-final-ack.ts";
import test from "node:test";
import {TEAM_ROLES} from "../../artifacts/api-server/src/lib/cst-ai-team-contract.ts";
import {EXTERNAL_TEAM_AGENTS} from "../../artifacts/api-server/src/lib/cst-ai-team-external-review.ts";
import {
  oneJobAgentSigningBytes,oneJobFinalAckSigningBytes,
  digestOneJobCoreManifest,digestOneJobAgentQuorum,projectSignedOneJobFourAgentReview,
} from "../../artifacts/api-server/src/lib/cst-team-onejob-signed-final-ack.ts";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const keys=Object.fromEntries(
 [...TEAM_ROLES,"reviewer"].map(role=>[role,generateKeyPairSync("ed25519")])
);
const trusted=Object.fromEntries(
 Object.entries(keys).map(([role,k])=>[role,{
  publicKeyPem:k.publicKey.export({type:"spki",format:"pem"}),
  publicKeySha256:sha(k.publicKey.export({type:"spki",format:"der"})),
 }])
);
const now=new Date("2026-11-20T05:02:00.000Z");
const manifest=Object.freeze({
 version:1,project:"xssrfshdrtdfupgqwfdw",companyId:"1",
 jobId:483,jobCode:"OLLAMA-A1B2C3D4",
 requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
 modelId:"qwen2.5:3b",workerId:991,sourceSha:"b".repeat(40),
 ownerApprovalSha256:"c".repeat(64),
 eventId:"25745d53-9c8d-46ae-8afc-62bfbba92711",
 publisherAuditSha256:"d".repeat(64),
 subscriberReceiptSha256:"e".repeat(64),
 challenge:"24a5dc22-318b-42b4-aaed-a7c84e24cd21",
 createdAt:"2026-11-20T05:00:00.000Z",
});
function agent(role,prior,offset,i=0) {
 const profile=EXTERNAL_TEAM_AGENTS[role];
 const payload={
  version:1,type:"CST_DEV_ONEJOB_AGENT_ATTESTATION",
  role,host:profile.host,agentId:profile.agentId,
  project:"xssrfshdrtdfupgqwfdw",companyId:"1",
  jobId:483,eventId:manifest.eventId,sourceSha:manifest.sourceSha,
  subscriberReceiptSha256:manifest.subscriberReceiptSha256,
  manifestSha256:digestOneJobCoreManifest(manifest),
  challenge:manifest.challenge,result:"PASS",
  summarySha256:String(i+1).repeat(64),
  priorThreeSha256:prior,nonce:String(i+5).repeat(64),
  observedAt:"2026-11-20T05:00:"+String(offset).padStart(2,"0")+".000Z",
 };
 return {payload,signatureBase64:sign(null,oneJobAgentSigningBytes(role,payload),
   keys[role].privateKey).toString("base64")};
}
function build() {
 const first=[
  agent("coding","0".repeat(64),5,0),
  agent("infrastructure","0".repeat(64),7,1),
  agent("security","0".repeat(64),9,2),
 ];
 const qa=agent("qa",digestOneJobAgentQuorum(first),14,3);
 const all=[...first,qa];
 const payload={
  version:1,type:"CST_DEV_ONEJOB_INDEPENDENT_FINAL_ACK",
  project:"xssrfshdrtdfupgqwfdw",companyId:"1",jobId:483,
  eventId:manifest.eventId,sourceSha:manifest.sourceSha,
  ownerApprovalSha256:manifest.ownerApprovalSha256,
  subscriberReceiptSha256:manifest.subscriberReceiptSha256,
  manifestSha256:digestOneJobCoreManifest(manifest),
  agentQuorumSha256:digestOneJobAgentQuorum(all),
  decision:"PASS",nonce:"9".repeat(64),
  issuedAt:"2026-11-20T05:00:20.000Z",
 };
 const finalAck={payload,signatureBase64:sign(null,
   oneJobFinalAckSigningBytes(payload),keys.reviewer.privateKey).toString("base64")};
 return {manifest,agentAttestations:all,finalAck,trustRoots:trusted};
}
const check=(input=build(),date=now)=>projectSignedOneJobFourAgentReview(input,date);
function reject(input,reason) {
 const v=check(input);
 assert.equal(v.signedBundleConsistent,false,JSON.stringify(v));
 assert.ok(v.blockers.includes(reason),JSON.stringify(v.blockers));
 assert.equal(v.independentFinalAckVerified,false);
 assert.equal(v.operationalE2EVerified,false);
 assert.equal(v.dispatchPermitted,false);
}
const tamper=(change)=>{
 const x=structuredClone(build());change(x);return x;
};

test("five independent Ed25519 public roots verify four signatures + FINAL ACK only as crypto lineage",()=>{
 const v=check();
 assert.equal(v.signedBundleConsistent,true,JSON.stringify(v));
 assert.equal(v.reviewedRoleCount,4);
 assert.deepEqual(v.blockers,[]);
 assert.equal(v.authenticatedOwnerSessionVerified,false);
 assert.equal(v.trustedLiveSignerCustodyVerified,false);
 assert.equal(v.realCstDevSubscriberReceiptReadbackVerified,false);
 assert.equal(v.independentFinalAckVerified,false);
 assert.equal(v.operationalE2EVerified,false);
 assert.equal(v.sideEffects,"NONE");
});

test("one missing role or swapped role or operator-collected text never authenticates",()=>{
 const b=build();
 reject({...b,agentAttestations:b.agentAttestations.slice(0,3)},
   "FOUR_DISTINCT_AGENT_RECEIPTS_REQUIRED");
 reject(tamper(x=>x.agentAttestations.reverse()),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 reject(tamper(x=>x.agentAttestations[0].payload.agentId="typed-by-operator"),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 reject(tamper(x=>x.agentAttestations[3].payload.agentId="ollama-local-qa"),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
});

test("all agent, final reviewer and approval roots must be distinct and pinned independently",()=>{
 reject(tamper(x=>x.trustRoots.qa.publicKeyPem=x.trustRoots.coding.publicKeyPem),
   "FIVE_INDEPENDENT_SIGNER_ROOTS_NOT_PINNED");
 reject(tamper(x=>x.trustRoots.reviewer=x.trustRoots.qa),
   "FIVE_INDEPENDENT_SIGNER_ROOTS_NOT_PINNED");
 reject(tamper(x=>x.trustRoots.security.publicKeySha256="f".repeat(64)),
   "FIVE_INDEPENDENT_SIGNER_ROOTS_NOT_PINNED");
 reject(tamper(x=>x.trustRoots.coding.publicKeyPem="NOT_A_KEY"),
   "FIVE_INDEPENDENT_SIGNER_ROOTS_NOT_PINNED");
});

test("tampering exact job, project, event, source, receipt or Owner approval hash fails",()=>{
 for(const [k,v] of [
  ["jobId",482],["companyId","3"],["project","nzdweipzckfszczzqtuw"],
  ["sourceSha","f".repeat(40)],["subscriberReceiptSha256","a".repeat(64)],
  ["ownerApprovalSha256","f".repeat(64)],
  ["eventId","25745d53-9c8d-46ae-8afc-62bfbba92712"],
 ]){
  reject(tamper(x=>x.manifest[k]=v),"AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 }
});

test("forged or unbound signatures and extra fields are never accepted",()=>{
 reject(tamper(x=>x.agentAttestations[0].signatureBase64=x.agentAttestations[1].signatureBase64),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 reject(tamper(x=>x.agentAttestations[1].payload.extraOwnerApproval=true),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 reject(tamper(x=>x.finalAck.payload.agentQuorumSha256="f".repeat(64)),
   "SEPARATE_SIGNED_FINAL_ACK_NOT_VERIFIED");
 reject(tamper(x=>x.finalAck.signatureBase64=x.agentAttestations[3].signatureBase64),
   "SEPARATE_SIGNED_FINAL_ACK_NOT_VERIFIED");
 reject(tamper(x=>x.finalAck.payload.extra=true),
   "SEPARATE_SIGNED_FINAL_ACK_NOT_VERIFIED");
});

test("independent QA must attest *after* three genuine signed roles, before final reviewer",()=>{
 reject(tamper(x=>x.agentAttestations[3].payload.priorThreeSha256="f".repeat(64)),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 reject(tamper(x=>x.agentAttestations[3].payload.observedAt="2026-11-20T04:59:59.000Z"),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 reject(tamper(x=>x.finalAck.payload.issuedAt="2026-11-20T05:00:01.000Z"),
   "SEPARATE_SIGNED_FINAL_ACK_NOT_VERIFIED");
 reject(tamper(x=>x.agentAttestations[3].payload.nonce=x.agentAttestations[0].payload.nonce),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
});

test("expired/future/duplicate evidence and historic #482 never qualify",()=>{
 const b=build();
 reject({...b,manifest:{...manifest,jobId:482}},
   "ONE_JOB_CORE_MANIFEST_NOT_VERIFIED");
 const old=new Date("2026-11-20T06:00:00.000Z");
 const v=check(b,old);
 assert.equal(v.signedBundleConsistent,false);
 assert.ok(v.blockers.includes("ONE_JOB_CORE_MANIFEST_NOT_VERIFIED"));
 reject(tamper(x=>x.manifest.createdAt="2026-11-20T05:05:00.000Z"),
   "ONE_JOB_CORE_MANIFEST_NOT_VERIFIED");
 reject(tamper(x=>x.agentAttestations[0].payload.observedAt="2026-11-19T05:00:05.000Z"),
   "AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
});

test("review source cannot silently promote unsigned UI records or run a new job",()=>{
 const s=readFileSync(new URL("../../artifacts/api-server/src/lib/cst-team-onejob-signed-final-ack.ts",import.meta.url),"utf8");
 assert.match(s,/independentFinalAckVerified:false/);
 assert.match(s,/trustedLiveSignerCustodyVerified:false/);
 assert.match(s,/dispatchPermitted:false/);
 assert.doesNotMatch(s,/from "pg"|from "child_process"|\bfetch\(/);
 const original=readFileSync(new URL("../../artifacts/api-server/src/lib/cst-ai-team-external-review.ts",import.meta.url),"utf8");
 assert.match(original,/DEV_OPERATOR_COLLECTED_UNATTESTED/);
 assert.match(original,/signatureVerified\s*!==\s*false/);
});


test("signed Core reconciliation and Hub 4+1 evidence must bind one exact job/event/ledger",()=>{
 const bundle=build();
 const core=generateKeyPairSync("ed25519");
 const fp=sha(core.publicKey.export({type:"spki",format:"der"}));
 const trust={use:"CST_DEV_ONEJOB_FINAL_ACK_PUBLIC_PIN",project:"xssrfshdrtdfupgqwfdw",
   issuerId:"cst-final-reconciler-dev",
   publicKeyPem:core.publicKey.export({type:"spki",format:"pem"}).toString(),
   fingerprint:fp};
 const claims={domain:"cst-onejob-core-reconciliation/v1",project:"xssrfshdrtdfupgqwfdw",
   approvalId:"123e4567-e89b-12d3-a456-426614174000",
   jobId:483,eventId:manifest.eventId,
   deliveryId:"123e4567-e89b-12d3-a456-426614174002",
   postNonce:"a".repeat(64),postProofDigest:"b".repeat(64),
   reconciliationId:"123e4567-e89b-12d3-a456-426614174003",
   issuedAt:"2026-11-20T05:00:18.000Z"};
 const bytes=Buffer.from(JSON.stringify(claims));
 const coreReconciliation={claims,signatureBase64:sign(null,bytes,core.privateKey).toString("base64")};
 const ledger={approvalId:claims.approvalId,jobId:483,eventId:claims.eventId,
   deliveryId:claims.deliveryId,reconciliationId:claims.reconciliationId,
   postNonce:claims.postNonce,postProofDigest:claims.postProofDigest,
   ackSignatureBase64:coreReconciliation.signatureBase64,issuerPublicFingerprint:fp,
   reconciliationClaimsDigest:sha(bytes),sourceSha:manifest.sourceSha,
   ownerApprovalSha256:manifest.ownerApprovalSha256,
   subscriberReceiptSha256:manifest.subscriberReceiptSha256};
 const input={hubBundle:bundle,hubTrustedRoots:trusted,
   coreReconciliation,coreIssuerRoot:trust,coreLedgerReadback:ledger};
 const okay=reviewOneJobCrossRepoFinalAck(input,now);
 assert.equal(okay.status,"SIGNED_CROSS_REPO_CONTRACT_MATCH_ONLY",JSON.stringify(okay));
 assert.equal(okay.coreSignedReconciliationMatched,true);
 assert.equal(okay.coreReconciliationNotFinalAck,true);
 assert.equal(okay.hubFourAgentSignaturesMatched,true);
 assert.equal(okay.independentDbReadbackVerified,false);
 assert.equal(okay.signerCustodyVerified,false);
 assert.equal(okay.independentFinalAckVerified,false);
 assert.equal(okay.operationalE2EVerified,false);
 assert.equal(okay.dispatchPermitted,false);
 const blocked=[
  {...input,coreReconciliation:{...coreReconciliation,signatureBase64:bundle.finalAck.signatureBase64}},
  {...input,coreReconciliation:{...coreReconciliation,claims:{...claims,eventId:"123e4567-e89b-12d3-a456-426614174009"}}},
  {...input,coreReconciliation:{...coreReconciliation,claims:{...claims,domain:"cst-onejob-final-ack/v1"},signatureBase64:sign(null,Buffer.from(JSON.stringify({...claims,domain:"cst-onejob-final-ack/v1"})),core.privateKey).toString("base64")}},
  {...input,coreLedgerReadback:{...ledger,reconciliationClaimsDigest:"c".repeat(64)}},
  {...input,coreLedgerReadback:{...ledger,sourceSha:"f".repeat(40)}},
  {...input,coreIssuerRoot:{...trust,fingerprint:trusted.reviewer.publicKeySha256}},
  {...input,hubBundle:{...bundle,agentAttestations:bundle.agentAttestations.slice(0,3)}},
 ];
 for(const bad of blocked){
  const result=reviewOneJobCrossRepoFinalAck(bad,now);
  assert.equal(result.status,"DENIED",JSON.stringify(result));
  assert.equal(result.operationalE2EVerified,false);
 }
});
test("cross-repo checker is pure and never turns operator evidence into release",()=>{
 const text=readFileSync(new URL(
  "../../artifacts/api-server/src/lib/cst-team-onejob-cross-repo-final-ack.ts",
  import.meta.url),"utf8");
 assert.match(text,/projectSignedOneJobFourAgentReview/);
 assert.match(text,/independentDbReadbackVerified:false/);
 assert.match(text,/independentFinalAckVerified:false/);
 assert.doesNotMatch(text,/from "pg"|child_process|fetch\(|CREATE ROLE|INSERT INTO/);
});
