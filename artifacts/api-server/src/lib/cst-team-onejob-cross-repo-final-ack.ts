/**
 * Bridge existing signed evidence contracts from the two Draft PRs.
 *
 * Hub: four independent agent Ed25519 signatures + reviewer signature.
 * Core: separate signed post-execution reconciliation record.
 * Both must agree with one independently obtained CST-DEV ledger readback.
 *
 * Pure, fail-closed cryptographic compatibility check. The readback and
 * public-key custody MUST be independently established by operations. This
 * code cannot attest to that custody, grant database authority, issue an ACK,
 * start a job, or promote a release. No credentials or network access.
 */
import {createHash,createPublicKey,verify} from "node:crypto";
import {projectSignedOneJobFourAgentReview}
  from "./cst-team-onejob-signed-final-ack.ts";

const PROJECT="xssrfshdrtdfupgqwfdw";
const DOMAIN="cst-onejob-final-ack/v1";
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BASE64=/^[A-Za-z0-9+/]{86}==$/;
const CORE_FIELDS=[
 "domain","project","approvalId","jobId","eventId","deliveryId",
 "postNonce","postProofDigest","finalAckId","issuedAt"
] as const;
type Obj=Record<string,unknown>;
const obj=(v:unknown):v is Obj=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[]):v is Obj=>
 obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
const isoMs=(v:unknown)=>{
 if(typeof v!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v))return NaN;
 const t=Date.parse(v);return Number.isFinite(t)&&new Date(t).toISOString()===v?t:NaN;
};
function coreBytes(v:Obj):Buffer{
 return Buffer.from(JSON.stringify(Object.fromEntries(CORE_FIELDS.map(k=>[k,v[k]]))),"utf8");
}
export function reviewOneJobCrossRepoFinalAck(input:{
  hubBundle?:unknown; hubTrustedRoots?:unknown;
  coreAck?:unknown; coreIssuerRoot?:unknown; coreLedgerReadback?:unknown;
},now:Date=new Date()){
 const blockers:string[]=[];
 const need=(ok:boolean,reason:string)=>{if(!ok)blockers.push(reason);};
 const bundle=obj(input?.hubBundle)?input.hubBundle:{};
 const hub=projectSignedOneJobFourAgentReview({
   manifest:bundle.manifest,agentAttestations:bundle.agentAttestations,
   finalAck:bundle.finalAck,trustRoots:input?.hubTrustedRoots,
 },now);
 need(hub.signedBundleConsistent,"HUB_FOUR_AGENTS_AND_REVIEWER_NOT_VERIFIED");
 const root=obj(input?.coreIssuerRoot)?input.coreIssuerRoot:null;
 const ack=obj(input?.coreAck)?input.coreAck:null;
 const claims=ack&&obj(ack.claims)?ack.claims:null;
 const ledger=obj(input?.coreLedgerReadback)?input.coreLedgerReadback:null;
 let coreKey:ReturnType<typeof createPublicKey>|null=null;
 let fp="";
 try{
   if(!root||root.use!=="CST_DEV_ONEJOB_FINAL_ACK_PUBLIC_PIN"||
      root.project!==PROJECT||typeof root.issuerId!=="string"||
      !/^cst-[a-z0-9_-]{8,80}$/.test(root.issuerId)||
      !HEX64.test(String(root.fingerprint)))throw Error("BAD_CORE_ROOT");
   coreKey=createPublicKey(String(root.publicKeyPem));
   fp=hash(coreKey.export({type:"spki",format:"der"}) as Buffer);
   if(coreKey.asymmetricKeyType!=="ed25519"||fp!==root.fingerprint)
     throw Error("BAD_CORE_ROOT_PIN");
 }catch{coreKey=null;}
 need(coreKey!==null,"CORE_RECONCILER_ROOT_NOT_PINNED");
 // The final Core issuer must not reuse any of the five Hub identities.
 const hubRoots=obj(input?.hubTrustedRoots)?input.hubTrustedRoots:{};
 const names=["coding","infrastructure","security","qa","reviewer"];
 const hubFingerprints=names.map(role=>obj(hubRoots[role])?
   hubRoots[role].publicKeySha256:null);
 need(fp!==""&&hubFingerprints.every(x=>typeof x==="string"&&x!==fp),
   "CORE_ISSUER_NOT_INDEPENDENT_FROM_HUB_QUORUM");
 const manifest=obj(bundle.manifest)?bundle.manifest:null;
 const hubAck=obj(bundle.finalAck)&&obj(bundle.finalAck.payload)?
   bundle.finalAck.payload:null;
 const current=now instanceof Date?now.getTime():NaN;
 const coreTime=isoMs(claims?.issuedAt);
 const hubTime=isoMs(hubAck?.issuedAt);
 const manifestTime=isoMs(manifest?.createdAt);
 need(exact(ack,["claims","signatureBase64"])&&exact(claims,CORE_FIELDS),
   "CORE_ACK_ENVELOPE_INVALID");
 let coreValid=false;
 if(coreKey&&claims&&exact(claims,CORE_FIELDS)&&ack&&
    typeof ack.signatureBase64==="string"&&BASE64.test(ack.signatureBase64)){
  const raw=Buffer.from(ack.signatureBase64,"base64");
  coreValid=raw.length===64&&raw.toString("base64")===ack.signatureBase64&&
    verify(null,coreBytes(claims),coreKey,raw);
 }
 need(coreValid,"CORE_ACK_SIGNATURE_NOT_VERIFIED");
 need(Boolean(claims&&claims.domain===DOMAIN&&claims.project===PROJECT&&
   Number.isSafeInteger(claims.jobId)&&Number(claims.jobId)>0&&
   claims.jobId!==482&&
   [claims.approvalId,claims.eventId,claims.deliveryId,claims.finalAckId]
     .every(x=>UUID.test(String(x)))&&
   HEX64.test(String(claims.postNonce))&&
   HEX64.test(String(claims.postProofDigest))&&
   Number.isFinite(current)&&Number.isFinite(coreTime)&&
   Number.isFinite(hubTime)&&Number.isFinite(manifestTime)&&
   manifestTime<=coreTime&&coreTime<=hubTime&&hubTime<=current+30000&&
   current-coreTime<=30*60_000),
   "CORE_ACK_SCOPE_OR_ORDER_INVALID");
 need(Boolean(claims&&manifest&&hubAck&&
   claims.jobId===manifest.jobId&&claims.eventId===manifest.eventId&&
   claims.jobId===hubAck.jobId&&claims.eventId===hubAck.eventId),
   "CROSS_REPO_JOB_EVENT_MISMATCH");
 // Ledger readback is an expected-value fixture here, NOT an authenticated
 // database session. Operations must separately prove its provenance.
 const ledgerValid=Boolean(claims&&ledger&&
   ledger.approvalId===claims.approvalId&&
   ledger.jobId===claims.jobId&&ledger.eventId===claims.eventId&&
   ledger.deliveryId===claims.deliveryId&&
   ledger.finalAckId===claims.finalAckId&&
   ledger.postNonce===claims.postNonce&&
   ledger.postProofDigest===claims.postProofDigest&&
   ledger.ackSignatureBase64===ack?.signatureBase64&&
   ledger.issuerPublicFingerprint===fp&&
   ledger.ackClaimsDigest===hash(coreBytes(claims))&&
   manifest&&ledger.sourceSha===manifest.sourceSha&&HEX40.test(String(ledger.sourceSha))&&
   ledger.ownerApprovalSha256===manifest.ownerApprovalSha256&&
   ledger.subscriberReceiptSha256===manifest.subscriberReceiptSha256);
 need(ledgerValid,"CORE_LEDGER_AND_HUB_MANIFEST_NOT_BOUND");
 return {
  status:blockers.length===0?"SIGNED_CROSS_REPO_CONTRACT_MATCH_ONLY":"DENIED",
  blockers,
  coreSignedReconciliationMatched:coreValid&&ledgerValid,
  hubFourAgentSignaturesMatched:hub.signedBundleConsistent,
  // No user-supplied receipt or bool can become live permission.
  independentDbReadbackVerified:false,
  signerCustodyVerified:false,authenticatedOwnerSessionVerified:false,
  independentFinalAckVerified:false,operationalE2EVerified:false,
  dispatchPermitted:false,sideEffects:"NONE"
 };
}
