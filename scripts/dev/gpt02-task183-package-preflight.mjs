import {existsSync,lstatSync,readlinkSync,realpathSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const ROOT='/opt/ai-task-gpt02-preparer';
const DEV_SECRET='/etc/credstore.encrypted/gpt02-task183-relock-dsn';
const REQUIRED=[
 'scripts/dev/gpt02-task183-relock-once.mjs',
 'scripts/dev/gpt02-preparer-relock-host-gate.mjs',
 'artifacts/api-server/package.json',
 'artifacts/api-server/node_modules/pg/package.json',
 'artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs',
 'deploy/systemd/gpt02-task183-preparer-relock.service',
 'deploy/systemd/gpt02-task183-preparer-relock.timer'
];
/** Inspection is metadata-only and does not read secrets. */
export function assessPackagePreflight({manifest,sourceFiles,activeLink,credential}={}){
 const reasons=[];
 if(!manifest||!/^([a-f0-9]{40})$/.test(manifest.source_commit||'')||
    !manifest.files||typeof manifest.files!=='object'){
   reasons.push('SOURCE_MANIFEST_UNVERIFIED');
 }else{
   for(const rel of REQUIRED){
     if(!sourceFiles?.[rel]?.exists)reasons.push('PACKAGE_FILE_MISSING:'+rel);
     if(rel!=='artifacts/api-server/node_modules/pg/package.json' &&
       rel!=='artifacts/api-server/package.json' &&
       rel!=='scripts/dev/gpt02-preparer-relock-host-gate.mjs' &&
       !sourceFiles?.[rel]?.hashVerified)
       reasons.push('PACKAGE_FILE_UNVERIFIED:'+rel);
   }
 }
 if(!activeLink?.isSymlink||!activeLink?.matchesManifest)
   reasons.push('IMMUTABLE_ACTIVE_RUNTIME_LINK_ABSENT_OR_MISMATCHED');
 if(!credential?.exists||credential.uid!==0||credential.mode!==0o600||
    !credential.isRegularFile)reasons.push('DEDICATED_RELOCK_SECRET_CUSTODY_NOT_ATTESTED');
 return Object.freeze({
  result:reasons.length?'NO_GO':'PACKAGE_METADATA_PRESENT_NOT_HOSTED_AUTHORITY',
  reasons:Object.freeze(reasons),
  hostedRoleUnlockPermitted:false,
  dispatchPermitted:false
 });
}
export function inspectPackagePreflight(root=ROOT,credPath=DEV_SECRET){
 const releases=join(root,'releases');
 const current=join(root,'current');
 let activeLink={isSymlink:false,matchesManifest:false};
 let manifest=null,release=null;
 try{
  const info=lstatSync(current);
  if(info.isSymbolicLink()){
   const target=realpathSync(current);
   if(target.startsWith(releases+'/')){
    const doc=JSON.parse(readFileSync(join(target,'source-manifest.json'),'utf8'));
    if(doc?.source_commit && target===join(releases,doc.source_commit)){
     activeLink={isSymlink:true,matchesManifest:true};
     manifest=doc;release=target;
    }
   }
  }
 }catch{}
 const sourceFiles={};
 if(release&&manifest){
  for(const rel of REQUIRED){
   try{
    const file=join(release,rel);
    const info=lstatSync(file);
    const exists=info.isFile()&&!info.isSymbolicLink();
    const recorded=manifest.files[rel];
    sourceFiles[rel]={exists,
      hashVerified:exists&&typeof recorded?.sha256==='string'&&
        createHash('sha256').update(readFileSync(file)).digest('hex')===recorded.sha256};
   }catch{sourceFiles[rel]={exists:false,hashVerified:false};}
  }
 }
 let credential={exists:false};
 try{
  const stat=lstatSync(credPath);
  credential={exists:true,uid:stat.uid,mode:stat.mode&0o777,isRegularFile:stat.isFile()&&!stat.isSymbolicLink()};
 }catch{}
 return assessPackagePreflight({manifest,sourceFiles,activeLink,credential});
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const result=inspectPackagePreflight();
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.result!=='PACKAGE_METADATA_PRESENT_NOT_HOSTED_AUTHORITY')process.exitCode=2;
}
