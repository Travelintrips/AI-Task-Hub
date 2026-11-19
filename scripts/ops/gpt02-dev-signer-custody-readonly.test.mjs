import test from 'node:test';
import assert from 'node:assert/strict';
import {assessGpt02SignerCustody,readGpt02CustodyMetadata}
 from './gpt02-dev-signer-custody-readonly.mjs';
const services=['hubReader','approvalReader','issuerReader','lineageReader','verifier'];
const files=['approvedClaims','hubCoreClaims','issuerClaims',
 'approvalSignature','hubSignature','coreSignature','issuerReaderSocket',
 'approvalReaderSocket','hubReaderSocket','verifierSocket','manifest'];
const credentials=['approval','hub','core','issuer'];
function ready(){
 return {services:Object.fromEntries(services.map(x=>[x,'active'])),
  files:Object.fromEntries(files.map(x=>[x,true])),
  encryptedCredentialPresent:Object.fromEntries(credentials.map(x=>[x,true]))};
}
test('even complete metadata cannot authorize signing, attestor, issuer or dispatch',()=>{
 const x=assessGpt02SignerCustody(ready());
 assert.equal(x.preconditionsComplete,true);
 assert.equal(x.reason,'SIGNER_METADATA_READY_NO_AUTHORITY');
 for(const key of ['operatorApprovalVerified','signatureVerified','signingPermitted',
  'attestorRecordPermitted','issuerLeaseGranted','dispatchPermitted'])
  assert.equal(x[key],false,key);
 assert.equal(x.releaseDecision,'NO_GO');
});
test('missing approved claims and issuer reader socket block existing one-shot custody',()=>{
 const x=ready();x.files.approvedClaims=false;x.files.issuerReaderSocket=false;
 const v=assessGpt02SignerCustody(x);
 assert.equal(v.reason,'SIGNER_PRECONDITIONS_INCOMPLETE');
 assert.equal(v.preconditionsComplete,false);
 assert.ok(v.details.includes('PREREQUISITE_approvedClaims'));
 assert.ok(v.details.includes('PREREQUISITE_issuerReaderSocket'));
});
test('missing signature evidence, expired services and credential escrow metadata fail closed',()=>{
 for(const group of ['services','files','encryptedCredentialPresent']){
  const x=ready(),key=Object.keys(x[group])[0];
  x[group][key]=group==='services'?'inactive':false;
  const result=assessGpt02SignerCustody(x);
  assert.equal(result.preconditionsComplete,false,group+':'+key);
  assert.equal(result.dispatchPermitted,false);
 }
});
test('malformed or absent snapshots cannot make sign-once ready',()=>{
 for(const v of [null,{},[],{services:{}},{files:{}},
  {services:{},files:{},encryptedCredentialPresent:{}}]){
  const x=assessGpt02SignerCustody(v);
  assert.equal(x.preconditionsComplete,false);
  assert.equal(x.releaseDecision,'NO_GO');
 }
});
test('metadata collection checks only fixed files and fixed service names without reading contents',()=>{
 let checks=0,servicesRead=0;
 const r=readGpt02CustodyMetadata({
  exists(path){checks++;assert.ok(path.startsWith('/'));return true},
  serviceState(name){servicesRead++;assert.match(name,/^gpt02-issue159-/);return 'active'}
 });
 assert.equal(Object.keys(r.services).length,5);
 assert.equal(checks,15);
 assert.equal(servicesRead,5);
 assert.equal(assessGpt02SignerCustody(r).preconditionsComplete,true);
});
test('unavailable systemctl, file errors and missing passwords always NO-GO',()=>{
 const r=readGpt02CustodyMetadata({
  exists(){throw Error('FS_UNAVAILABLE')},
  serviceState(){throw Error('UNIT_UNAVAILABLE')}
 });
 assert.equal(assessGpt02SignerCustody(r).preconditionsComplete,false);
});
