/**
 * CST-DEV ONLY. Non-mutating readiness verifier for four GPT02 public trust roots.
 * Reads the fixed root-owned manifest + fixed public-key mount via reviewed loaders.
 * Never creates keys, reads private keys, signs, opens DB sessions, calls issuer,
 * creates tasks, or grants dispatch.
 */
import {loadGpt02DevTrustManifest} from '../../artifacts/api-server/src/lib/gpt02-dev-trust-manifest.mjs';
import {loadGpt02DevTrustStore} from '../../artifacts/api-server/src/lib/gpt02-dev-trust-store.mjs';

const BASE=Object.freeze({
 environment:'CST-DEV',
 mode:'FOUR_PUBLIC_TRUST_ROOT_READINESS',
 manifestVerified:false,
 publicKeysVerified:false,
 independentSignerCount:0,
 issuerLeaseGranted:false,
 dispatchPermitted:false,
 releaseDecision:'NO_GO'
});
const report=(reason,extra={})=>Object.freeze({...BASE,...extra,reason,
 issuerLeaseGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'});

export function verifyFourSignerTrustReadiness(deps={}){
 const loadManifest=deps.loadManifest||loadGpt02DevTrustManifest;
 const loadStore=deps.loadStore||loadGpt02DevTrustStore;
 let manifest;
 try{manifest=loadManifest();}
 catch{return report('TRUST_MANIFEST_NOT_VERIFIED');}
 if(!manifest||manifest.environment!=='DEV'||manifest.source!=='root-owned-fixed-manifest'||
    !manifest.fingerprints||Object.keys(manifest.fingerprints).length!==4)
  return report('TRUST_MANIFEST_NOT_VERIFIED');
 try{
  const store=loadStore();
  const hashes=Object.values(store?.metadata?.fingerprints||{});
  if(store?.metadata?.environment!=='DEV'||hashes.length!==4||
     new Set(hashes).size!==4||store.dispatchPermitted!==false)
   return report('FOUR_PUBLIC_TRUST_ROOTS_NOT_VERIFIED',{manifestVerified:true});
  return report('FOUR_PUBLIC_TRUST_ROOTS_PASS_NO_AUTHORITY',{
   manifestVerified:true,publicKeysVerified:true,independentSignerCount:4
  });
 }catch{
  return report('FOUR_PUBLIC_TRUST_ROOTS_NOT_VERIFIED',{manifestVerified:true});
 }
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
 const out=verifyFourSignerTrustReadiness();
 process.stdout.write(JSON.stringify(out)+'\n');
 if(!out.publicKeysVerified)process.exitCode=2;
}
