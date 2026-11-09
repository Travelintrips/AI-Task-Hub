"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {generateKeyPairSync,sign}=require("node:crypto");
const {inspectSignedApproval:inspect,canonicalPayload}=require("./gpt02-signed-operator-approval-preview.cjs");
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const {publicKey:otherKey}=generateKeyPairSync("ed25519");
const pem=publicKey.export({format:"pem",type:"spki"}).toString();
const now=1794222000000;
const candidate={v:1,environment:"DEV",audience:"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
 taskId:136,commandId:"28cbdd95-b19c-45b1-8ec8-ac3b1fef182e",
 attemptId:"dce3d0b7-4e9e-4a0e-bac0-b0e654ea77b0",
 nonce:"rQCfYm6TDsPvxgf9QEM3m8Rdpqba32Py",
 superAdminId:10,companyId:"default",issuedAt:now-1000,expiresAt:now+60000};
function payload(x=candidate){return sign(null,Buffer.from(canonicalPayload(x)),privateKey).toString("base64url")}
function checked(x=candidate,opts={}){return inspect({claims:x,signatureBase64url:opts.signature??(canonicalPayload(x)?payload(x):payload()),
 publicKeyPem:opts.pem??pem,now:opts.now??now})}
test("valid signed DEV new-task preview never grants approval, issuer or dispatch",()=>{
 const r=checked();assert.equal(r.signatureValid,true);assert.equal(r.claimsValid,true);
 assert.equal(r.operatorApprovalRecorded,false);assert.equal(r.issuerPermitted,false);
 assert.equal(r.dispatchPermitted,false);assert.equal(r.decision,"NO_GO");
});
test("signed Task 135 is forbidden and PROD claims are forbidden",()=>{
 for(const claims of [{...candidate,taskId:135},{...candidate,environment:"PROD"},
  {...candidate,audience:"GENERAL_APPROVAL"}]){
  assert.equal(checked(claims).signatureValid,false);
 }
});
test("invalid, expired, future and excessively long claims are rejected",()=>{
 const bad=[{...candidate,expiresAt:now},{...candidate,issuedAt:now+10000},
  {...candidate,expiresAt:now+3600000},{...candidate,nonce:"short"},
  {...candidate,superAdminId:0},{...candidate,companyId:"../default"},
  {...candidate,commandId:candidate.attemptId},{...candidate,extra:"x"}];
 for(const c of bad)assert.equal(checked(c).signatureValid,false);
});
test("signature cannot be reused after changing task, command, PIC company or nonce",()=>{
 const original=payload();
 for(const mutated of [{...candidate,taskId:137},{...candidate,companyId:"company_other"},
  {...candidate,commandId:"83db99f5-cbda-4e60-be71-3090fb411bbb"},
  {...candidate,nonce:"z".repeat(40)}]){
  const r=checked(mutated,{signature:original});
  assert.equal(r.signatureValid,false);
 }
});
test("wrong key, malformed key or malformed signature are rejected",()=>{
 assert.equal(checked(candidate,{pem:otherKey.export({type:"spki",format:"pem"}).toString()}).signatureValid,false);
 assert.equal(checked(candidate,{pem:"not a key"}).signatureValid,false);
 assert.equal(checked(candidate,{signature:"bad"}).signatureValid,false);
});
test("no request or attacker-supplied booleans can become runtime authorization",()=>{
 assert.equal(inspect().decision,"NO_GO");
 const x={...candidate,issuerPermitted:true};
 assert.equal(checked(x).issuerPermitted,false);
 assert.equal(checked(x).signatureValid,false);
});
