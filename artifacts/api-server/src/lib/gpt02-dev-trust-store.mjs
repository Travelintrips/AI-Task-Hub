/**
 * GPT02 DEV-only: read four *public* Ed25519 trust anchors from dedicated,
 * restricted on-host files. Not an approval signer, key generator, issuer,
 * authorization check, or runtime dispatcher. No network/database access.
 *
 * Expected SHA256 SPKI fingerprints must come from an independently reviewed
 * deployment manifest, NEVER from HTTP input or from the same untrusted files.
 */
import {
 constants, lstatSync, openSync, fstatSync, readFileSync, closeSync
} from 'node:fs';
import {join} from 'node:path';
import {createHash,createPublicKey} from 'node:crypto';
import {loadGpt02DevTrustManifest} from './gpt02-dev-trust-manifest.mjs';

const ROOT='/run/credentials/gpt02-dev';
const LABELS=Object.freeze({
 approval:'approval-public.pem',
 hub:'hub-identity-public.pem',
 core:'core-identity-public.pem',
 issuer:'issuer-public.pem'
});
const OUTPUT=Object.freeze({
 approval:'approvalPublicKeyPem',
 hub:'hubPublicKeyPem',
 core:'corePublicKeyPem',
 issuer:'issuerPublicKeyPem'
});
const FINGERPRINT=/^[a-f0-9]{64}$/;
const PEM=/^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----\r?\n?$/;
export class Gpt02TrustStoreError extends Error{
 constructor(code){super(code);this.name='Gpt02TrustStoreError';this.code=code;}
}
const deny=(code)=>{throw new Gpt02TrustStoreError(code)};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,fields)=>object(x)&&Object.keys(x).sort().join(',')===[...fields].sort().join(',');
const expectedLabels=Object.keys(LABELS);

function secureDirectory(path,uid){
 let s;try{s=lstatSync(path)}catch{deny('TRUST_STORE_DIRECTORY_NOT_FOUND')}
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o077)!==0||
    (s.mode&0o500)!==0o500)deny('TRUST_STORE_DIRECTORY_UNSAFE');
}
function restrictedPublicKey(path,uid){
 let fd;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC);}
 catch{deny('TRUST_PUBLIC_KEY_UNAVAILABLE')}
 try{
  const s=fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||s.uid!==uid||(s.mode&0o177)!==0||
     s.size<100||s.size>2048)deny('TRUST_PUBLIC_KEY_FILE_UNSAFE');
  const pem=readFileSync(fd,{encoding:'utf8'});
  if(!PEM.test(pem))deny('TRUST_PUBLIC_KEY_FORMAT_REJECTED');
  let key;
  try{key=createPublicKey(pem)}catch{deny('TRUST_PUBLIC_KEY_FORMAT_REJECTED')}
  if(key.asymmetricKeyType!=='ed25519')deny('TRUST_ED25519_REQUIRED');
  const fingerprint=createHash('sha256').update(key.export({format:'der',type:'spki'}))
    .digest('hex');
  return Object.freeze({pem,fingerprint});
 }finally{closeSync(fd)}
}
/** No public key can be learned from a caller-supplied approval envelope. */
export function loadGpt02DevTrustStore({expectedFingerprints,root=ROOT}={}){
 const synthetic=process.env.NODE_ENV==='test'&&process.env.APP_ENV!=='production';
 if(typeof root!=='string'||!root.startsWith('/')||
   (root!==ROOT&&!synthetic))deny('GPT02_FIXED_DEV_TRUST_ROOT_REQUIRED');
 if(!synthetic&&expectedFingerprints!==undefined)
   deny('GPT02_CALLER_TRUST_MANIFEST_FORBIDDEN');
 const pins=synthetic&&expectedFingerprints!==undefined
   ? expectedFingerprints
   : loadGpt02DevTrustManifest().fingerprints;
 if(!exact(pins,expectedLabels)||
  expectedLabels.some(n=>typeof pins[n]!=='string'||
   !FINGERPRINT.test(pins[n]))||
  new Set(Object.values(pins)).size!==4)
   deny('TRUST_FINGERPRINT_MANIFEST_INVALID');
 const uid=typeof process.getuid==='function'?process.getuid():null;
 if(!Number.isInteger(uid))deny('POSIX_TRUST_STORE_REQUIRED');
 secureDirectory(root,uid);
 const keys={},hashes=[];
 for(const name of expectedLabels){
  const x=restrictedPublicKey(join(root,LABELS[name]),uid);
  if(x.fingerprint!==pins[name])deny('TRUST_FINGERPRINT_MISMATCH');
  hashes.push(x.fingerprint);
  keys[OUTPUT[name]]=x.pem;
 }
 if(new Set(hashes).size!==4)deny('FOUR_INDEPENDENT_KEYS_REQUIRED');
 return Object.freeze({
  ...keys,
  metadata:Object.freeze({environment:'DEV',fingerprints:Object.freeze({...pins})}),
  issuerLeaseGranted:false,dispatchPermitted:false
 });
}
