/**
 * GPT02 DEV four-signer canonical byte contract.
 *
 * This module DOES NOT sign, load private keys, read credentials, authorize,
 * consume nonces, create tasks, issue leases or dispatch workers. It only
 * produces the exact bytes already required by the independent verifiers.
 */
import {canonicalApproval} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
import {
  canonicalOperatorLink,
  operatorLinkSigningBytes
} from '../../artifacts/api-server/src/lib/gpt02-operator-link.mjs';
import {canonicalIssuerLeaseEvidence}
  from '../../artifacts/api-server/src/lib/gpt02-issuer-lease-evidence.mjs';

export const GPT02_SIGNER_ROLES=Object.freeze(['approval','hub','core','issuer']);

export const GPT02_SIGNER_DOMAINS=Object.freeze({
 approval:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',
 hub:'GPT02_OPERATOR_LINK_V1:hub',
 core:'GPT02_OPERATOR_LINK_V1:core',
 issuer:'GPT02_ISSUER_LEASE_EVIDENCE_V1'
});

const fail=code=>{const e=new Error(code);e.code=code;throw e;};

export function gpt02SignerSigningBytes(role,claims){
 if(!GPT02_SIGNER_ROLES.includes(role))fail('GPT02_SIGNER_ROLE_INVALID');
 if(role==='approval')
  return Buffer.from(canonicalApproval(claims),'utf8');
 if(role==='hub'||role==='core')
  return operatorLinkSigningBytes(claims,role);
 if(role==='issuer')
  return Buffer.from('GPT02_ISSUER_LEASE_EVIDENCE_V1\n'+
    canonicalIssuerLeaseEvidence(claims),'utf8');
 fail('GPT02_SIGNER_ROLE_INVALID');
}

export function gpt02SignerContract(role){
 if(!GPT02_SIGNER_ROLES.includes(role))fail('GPT02_SIGNER_ROLE_INVALID');
 return Object.freeze({
  role,
  environment:'DEV',
  domain:GPT02_SIGNER_DOMAINS[role],
  algorithm:'Ed25519',
  authorizationGranted:false,
  dispatchPermitted:false,
  privateKeyLoaded:false,
  signerMounted:false
 });
}
