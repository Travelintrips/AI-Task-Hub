import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';

export const CREDENTIAL_DIR='/run/credentials/gpt02-core-preparer.service';

/**
 * Metadata-only deployment check. Never reads environment values, DSNs,
 * certificates or tokens. A PASS here is only mount/access readiness,
 * NEVER a database-identity, secret-custody or preparation approval.
 */
export function assessPreparerContainerBoundary({
  processUid, mounts=[], credentialDirPresent=false,
  featureEnabled=false, dedicatedConsumer=false
}={}){
  const reasons=[];
  const mount=mounts.find(m=>m?.Destination===CREDENTIAL_DIR);
  if(!mount)reasons.push('CREDENTIAL_DIRECTORY_NOT_MOUNTED');
  else if(mount.RW!==false)reasons.push('CREDENTIAL_MOUNT_NOT_READ_ONLY');
  if(!credentialDirPresent)reasons.push('CREDENTIAL_DIRECTORY_ABSENT');
  if(!Number.isInteger(processUid))reasons.push('PROCESS_IDENTITY_UNKNOWN');
  // Existing file reader checks root:root 0550 directory and root:root 0400/0440/0600 files.
  // Docker node UID 1000 cannot traverse that directory, even with a read-only mount.
  else if(processUid!==0 && !dedicatedConsumer)reasons.push('ROOT_ONLY_CREDENTIAL_UNREADABLE_BY_CONTAINER_USER');
  // Never suggest running the full API as root to work around the access mismatch.
  if(processUid===0 && !dedicatedConsumer)reasons.push('ROOT_APPLICATION_NOT_PERMITTED_AS_WORKAROUND');
  if(featureEnabled)reasons.push('PREPARATION_FLAG_MUST_REMAIN_DISABLED');
  if(!dedicatedConsumer)reasons.push('DEDICATED_CREDENTIAL_CONSUMER_NOT_ATTESTED');
  return Object.freeze({ready:reasons.length===0,reasons,dispatchPermitted:false});
}

export function inspectLiveContainer(name='ai-task-pr196-ee0dd1b-staged'){
  // Returns Docker metadata only. Config.Env and Mount.Source are never displayed.
  const raw=execFileSync('docker',['inspect',name,'--format','{{json .Mounts}}'],{encoding:'utf8',timeout:5000});
  const mounts=JSON.parse(raw);
  const uid=Number(execFileSync('docker',['exec',name,'id','-u'],{encoding:'utf8',timeout:5000}).trim());
  const result=assessPreparerContainerBoundary({
    processUid:uid,mounts,credentialDirPresent:existsSync(CREDENTIAL_DIR),
    featureEnabled:false,dedicatedConsumer:false
  });
  return result;
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=inspectLiveContainer(process.argv[2]);
    process.stdout.write(JSON.stringify(result)+'\n');
    process.exitCode=result.ready?0:2;
  }catch{
    process.stdout.write(JSON.stringify({ready:false,reasons:['CONTAINER_METADATA_UNAVAILABLE'],dispatchPermitted:false})+'\n');
    process.exitCode=2;
  }
}
