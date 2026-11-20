/**
 * CST-DEV one-job: signed four-agent + reviewer FINAL ACK cryptographic
 * projection only. No signing, RPC, DB writes or dispatch. Operator-collected
 * external reviews never become independent signed attestations.
 *
 * Trust roots come from separate, reviewed custody, never from envelopes.
 * A valid synthetic bundle is NOT proof of real independent agent operation.
 */
import {createHash,createPublicKey,verify} from "node:crypto";
import {TEAM_ROLES,type TeamRole} from "./cst-ai-team-contract.ts";
import {EXTERNAL_TEAM_AGENTS} from "./cst-ai-team-external-review.ts";

const PROJECT="xssrfshdrtdfupgqwfdw";
const HEX64=/^[a-f0-9]{64}$/;
const HEX40=/^[a-f0-9]{40}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const MANIFEST_FIELDS=[
  "version","project","companyId","jobId","jobCode","requestId","modelId",
  "workerId","sourceSha","ownerApprovalSha256","eventId",
  "publisherAuditSha256","subscriberReceiptSha256","challenge","createdAt"
] as const;
const AGENT_FIELDS=[
 "version","type","role","host","agentId","project","companyId","jobId",
 "eventId","sourceSha","subscriberReceiptSha256","manifestSha256","challenge","result",
 "summarySha256","priorThreeSha256","nonce","observedAt"
] as const;
const FINAL_ACK_FIELDS=[
 "version","type","project","companyId","jobId","eventId","sourceSha",
 "ownerApprovalSha256","subscriberReceiptSha256","manifestSha256","agentQuorumSha256",
 "decision","nonce","issuedAt"
] as const;
type Obj=Record<string,unknown>;
type Signed={payload:Obj;signatureBase64:string};
type Root={publicKeyPem:string;publicKeySha256:string};
const safeObj=(v:unknown):v is Obj=>v!=null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:unknown,fields:readonly string[]):v is Obj=>safeObj(v)&&
  Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));
const safeId=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const time=(v:unknown):number=>{
 if(typeof v!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v))return NaN;
 const n=Date.parse(v);
 return Number.isFinite(n)&&new Date(n).toISOString()===v?n:NaN;
};
const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
function serialize(v:unknown,fields:readonly string[]):Buffer {
 if(!exact(v,fields))throw Error("ONEJOB_UNEXPECTED_SIGNED_FIELDS");
 return Buffer.from(JSON.stringify(Object.fromEntries(fields.map(k=>[k,v[k]]))),"utf8");
}
export function digestOneJobCoreManifest(manifest:unknown):string {
 return sha(serialize(manifest,MANIFEST_FIELDS));
}\nexport function oneJobAgentSigningBytes(role:TeamRole,payload:unknown):Buffer {
 if(!TEAM_ROLES.includes(role))throw Error("ONEJOB_SIGNER_ROLE_INVALID");
 return Buffer.concat([
  Buffer.from("CST_DEV_ONEJOB_AGENT_ATTESTATION_V1:"+role+"\n","utf8"),
  serialize(payload,AGENT_FIELDS),
 ]);
}
export function oneJobFinalAckSigningBytes(payload:unknown):Buffer{
 return Buffer.concat([
  Buffer.from("CST_DEV_ONEJOB_INDEPENDENT_FINAL_ACK_V1\n","utf8"),
  serialize(payload,FINAL_ACK_FIELDS),
 ]);
}
function validateRoot(root:Root):{pem:string;fingerprint:string}|null{
 try {
  if(typeof root?.publicKeyPem!=="string"||
     typeof root?.publicKeySha256!=="string"||!HEX64.test(root.publicKeySha256))
    return null;
  const key=createPublicKey(root.publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")return null;
  const hash=sha(key.export({type:"spki",format:"der"}) as Buffer);
  return hash===root.publicKeySha256?{pem:root.publicKeyPem,fingerprint:hash}:null;
 }catch{return null;}
}
function signedOkay(data:Signed,root:Root,bytes:Buffer):boolean {
 try{
  const good=validateRoot(root);
  if(!good || typeof data?.signatureBase64!=="string" ||
     !/^[A-Za-z0-9+/]{86}==$/.test(data.signatureBase64))return false;
  const sig=Buffer.from(data.signatureBase64,"base64");
  return sig.length===64 &&
    sig.toString("base64")===data.signatureBase64 &&
    verify(null,bytes,createPublicKey(good.pem),sig);
 }catch{return false;}
}
function checkManifest(v:unknown,now:number):v is Obj {
 if(!exact(v,MANIFEST_FIELDS))return false;
 const t=time(v.createdAt);
 return v.version===1 && v.project===PROJECT && v.companyId==="1" &&
   safeId(v.jobId)&&v.jobId!==482 &&
   typeof v.jobCode==="string"&&/^OLLAMA-[A-F0-9]{8}$/.test(v.jobCode) &&
   REQUEST.test(String(v.requestId)) && v.modelId==="qwen2.5:3b" &&
   safeId(v.workerId)&& HEX40.test(String(v.sourceSha)) &&
   [v.ownerApprovalSha256,v.publisherAuditSha256,v.subscriberReceiptSha256]
     .every(h=>HEX64.test(String(h))) &&
   UUID.test(String(v.eventId)) && UUID.test(String(v.challenge)) &&
   Number.isFinite(t)&&t<=now+30000&&now-t<=30*60_000;
}
function verifyAgent(
 r:unknown,role:TeamRole,manifest:Obj,root:Root,start:number,now:number,
 prior:string
):r is Signed {
 if(!safeObj(r)||Object.keys(r).length!==2||
    !Object.hasOwn(r,"payload")||!Object.hasOwn(r,"signatureBase64")||
    !exact(r.payload,AGENT_FIELDS))return false;
 const p=r.payload as Obj;
 const profile=EXTERNAL_TEAM_AGENTS[role];
 const observed=time(p.observedAt);
 const valid=p.version===1&&p.type==="CST_DEV_ONEJOB_AGENT_ATTESTATION" &&
   p.role===role && p.host===profile.host && p.agentId===profile.agentId &&
   p.project===PROJECT && p.companyId==="1" &&
   p.jobId===manifest.jobId && p.eventId===manifest.eventId &&
   p.sourceSha===manifest.sourceSha &&
   p.subscriberReceiptSha256===manifest.subscriberReceiptSha256 &&
   p.manifestSha256===digestOneJobCoreManifest(manifest) &&
   p.challenge===manifest.challenge && p.result==="PASS" &&
   HEX64.test(String(p.summarySha256)) &&
   p.priorThreeSha256===prior &&
   HEX64.test(String(p.nonce)) &&
   Number.isFinite(observed) && observed>=start &&
   observed<=now+30000 && observed-start<=30*60_000;
 return valid && signedOkay(r as Signed,root,oneJobAgentSigningBytes(role,p));
}
const digestEnvelope=(r:Signed):string=>sha(Buffer.concat([
 serialize(r.payload,AGENT_FIELDS),Buffer.from("\n"+r.signatureBase64,"utf8")
]));
export const digestOneJobAgentQuorum=(list:Signed[]):string=>
 sha(list.map(digestEnvelope).join("\n"));

/** Four role signatures + independent reviewer must match SAME job bundle.
 * The reviewer never grants live authority until session/custody and a durable
 * real-DB readback have been separately verified.
 */
export function projectSignedOneJobFourAgentReview(input:{
 manifest?:unknown;agentAttestations?:unknown;finalAck?:unknown;trustRoots?:unknown;
},now:Date=new Date()){
 const blockers:string[]=[];
 const need=(pass:boolean,label:string)=>{if(!pass)blockers.push(label);};
 const t=now instanceof Date?now.getTime():NaN;
 const m=input?.manifest;
 const validManifest=Number.isFinite(t)&&checkManifest(m,t);
 need(validManifest,"ONE_JOB_CORE_MANIFEST_NOT_VERIFIED");
 const roots=safeObj(input?.trustRoots)?input.trustRoots:{};
 const names=[...TEAM_ROLES,"reviewer"];
 const fingerprints=names.map(role=>validateRoot(roots[role] as Root)?.fingerprint??null);
 const trustValid=fingerprints.every(Boolean)&&new Set(fingerprints).size===5;
 need(trustValid,"FIVE_INDEPENDENT_SIGNER_ROOTS_NOT_PINNED");
 const attest=input?.agentAttestations;
 const all=Array.isArray(attest)?attest:[];
 need(all.length===4,"FOUR_DISTINCT_AGENT_RECEIPTS_REQUIRED");
 let agentOkay=validManifest&&trustValid&&all.length===4;
 let quorum="";
 if(agentOkay&&safeObj(m)){
  const created=time(m.createdAt);
  const first=all.slice(0,3);
  const firstChecks=(["coding","infrastructure","security"] as TeamRole[])
   .every((role,i)=>verifyAgent(first[i],role,m,roots[role] as Root,created,t,"0".repeat(64)));
  if(!firstChecks)agentOkay=false;
  else {
   const digestThree=digestOneJobAgentQuorum(first as Signed[]);
   agentOkay=verifyAgent(all[3],"qa",m,roots["qa"] as Root,created,t,digestThree);
   if(agentOkay){
    const at=all.map(a=>time((a as Signed).payload.observedAt));
    if(at[3]<Math.max(...at.slice(0,3)))agentOkay=false;
    const nonces=all.map(a=>(a as Signed).payload.nonce);
    if(new Set(nonces).size!==4)agentOkay=false;
    if(agentOkay)quorum=digestOneJobAgentQuorum(all as Signed[]);
   }
  }
 }
 need(agentOkay,"AGENT_SIGNATURES_ORDER_OR_LINEAGE_INVALID");
 const final=input?.finalAck;
 let finalValid=false;
 if(validManifest&&trustValid&&agentOkay&&safeObj(m)&&
    safeObj(final)&&Object.keys(final).length===2&&
    exact(final.payload,FINAL_ACK_FIELDS)){
  const p=final.payload;
  const issued=time(p.issuedAt),qaAt=time((all[3] as Signed).payload.observedAt);
  finalValid=p.version===1&&p.type==="CST_DEV_ONEJOB_INDEPENDENT_FINAL_ACK" &&
   p.project===PROJECT&&p.companyId==="1"&&p.jobId===m.jobId &&
   p.eventId===m.eventId&&p.sourceSha===m.sourceSha &&
   p.ownerApprovalSha256===m.ownerApprovalSha256 &&
   p.subscriberReceiptSha256===m.subscriberReceiptSha256 &&
   p.manifestSha256===digestOneJobCoreManifest(m) &&
   p.agentQuorumSha256===quorum && p.decision==="PASS" &&
   HEX64.test(String(p.nonce))&&
   Number.isFinite(issued)&&issued>=qaAt&&issued<=t+30000 &&
   issued-time(m.createdAt)<=30*60_000 &&
   !all.some(a=>(a as Signed).payload.nonce===p.nonce) &&
   signedOkay(final as Signed,roots["reviewer"] as Root,oneJobFinalAckSigningBytes(p));
 }
 need(finalValid,"SEPARATE_SIGNED_FINAL_ACK_NOT_VERIFIED");
 return {
  check:"CST_DEV_ONE_JOB_FOUR_AGENT_FINAL_ACK",
  mode:"SIGNED_BUNDLE_CRYPTOGRAPHIC_PROJECTION_ONLY",
  signedBundleConsistent:blockers.length===0,
  reviewedRoleCount:agentOkay?4:0,
  blockers,
  // Cryptographic fixture alone does not prove signer autonomy, Owner login,
  // real independent subscriber DB readback or dispatch authority.
  trustedLiveSignerCustodyVerified:false,
  realCstDevSubscriberReceiptReadbackVerified:false,
  authenticatedOwnerSessionVerified:false,
  independentFinalAckVerified:false,
  operationalE2EVerified:false,
  dispatchPermitted:false,
  sideEffects:"NONE",
 };
}
