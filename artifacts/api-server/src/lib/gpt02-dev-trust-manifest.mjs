/**
 * GPT02 DEV-only trust fingerprint manifest loader.
 *
 * Operational DEV reads one fixed, root-owned public manifest. The application
 * runtime may read it but must not be able to replace it. No private keys,
 * database access, network access, signing, issuer or dispatch logic.
 */
import {constants,lstatSync,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {dirname} from 'node:path';

const MANIFEST='/etc/gpt02-dev/trust-fingerprints.json';
const LABELS=Object.freeze(['approval','hub','core','issuer']);
const FINGERPRINT=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=x=>object(x)&&Object.keys(x).sort().join(',')===[...LABELS].sort().join(',');

export class Gpt02TrustManifestError extends Error{
 constructor(code){super(code);this.name='Gpt02TrustManifestError';this.code=code;}
}
const deny=code=>{throw new Gpt02TrustManifestError(code)};

function secureRootDirectory(path,ownerUid){
 let s;try{s=lstatSync(path)}catch{deny('TRUST_MANIFEST_DIRECTORY_NOT_FOUND')}
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==ownerUid||
    (s.mode&0o022)!==0||(s.mode&0o500)!==0o500)
  deny('TRUST_MANIFEST_DIRECTORY_UNSAFE');
}
function readManifestFile(path,ownerUid){
 let fd;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC)}
 catch{deny('TRUST_MANIFEST_FILE_UNAVAILABLE')}
 try{
  const s=fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||s.uid!==ownerUid||(s.mode&0o022)!==0||
     s.size<2||s.size>4096)
   deny('TRUST_MANIFEST_FILE_UNSAFE');
  const raw=readFileSync(fd,{encoding:'utf8'});
  let parsed;try{parsed=JSON.parse(raw)}catch{deny('TRUST_MANIFEST_JSON_INVALID')}
  if(!exact(parsed)||LABELS.some(k=>typeof parsed[k]!=='string'||!FINGERPRINT.test(parsed[k]))||
     new Set(Object.values(parsed)).size!==4)
   deny('TRUST_FINGERPRINT_MANIFEST_INVALID');
  return Object.freeze({...parsed});
 }finally{closeSync(fd)}
}

export function loadGpt02DevTrustManifest({
 path=MANIFEST,
 ownerUid=0
}={}){
 const synthetic=process.env.NODE_ENV==='test'&&process.env.APP_ENV!=='production';
 if(typeof path!=='string'||!path.startsWith('/')||
    (!synthetic&&(path!==MANIFEST||ownerUid!==0)))
  deny('GPT02_FIXED_DEV_TRUST_MANIFEST_REQUIRED');
 if(!Number.isInteger(ownerUid)||ownerUid<0)
  deny('TRUST_MANIFEST_OWNER_INVALID');
 secureRootDirectory(dirname(path),ownerUid);
 const fingerprints=readManifestFile(path,ownerUid);
 return Object.freeze({
  environment:'DEV',
  source:'root-owned-fixed-manifest',
  fingerprints
 });
}
