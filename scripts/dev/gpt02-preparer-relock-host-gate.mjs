/**
 * Task183 DEV: read-only independent-relock deployment evidence.
 * Never unlocks a PostgreSQL role, reads credentials, invokes a task,
 * starts a systemd service, or grants preparation authority.
 */
import {execFileSync} from 'node:child_process';

const PREPARER='gpt02-core-preparer.service';
const RELOCK='gpt02-task183-preparer-relock.service';
const TIMER='gpt02-task183-preparer-relock.timer';
const FIELDS='LoadState,ActiveState,UnitFileState,RefuseManualStart,NextElapseUSecRealtime';
function statusFromSystemd(unit){
 try{
  const output=execFileSync('systemctl',['show',unit,...FIELDS.split(',').map(x=>'-p'+x),'--no-pager'],{encoding:'utf8',timeout:4000});
  return Object.fromEntries(output.split('\n').filter(x=>x.includes('=')).map(x=>{
   const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];
  }));
 }catch{return {LoadState:'unavailable'};}
}
export function assessLocalRelockGate({preparer,relock,timer}){
 const reasons=[];
 if(preparer?.LoadState!=='loaded')reasons.push('PREPARER_UNIT_NOT_INSTALLED');
 if(preparer?.ActiveState!=='inactive')reasons.push('PREPARER_MUST_BE_INACTIVE');
 if(preparer?.RefuseManualStart!=='yes')reasons.push('PREPARER_MANUAL_START_MUST_BE_DENIED');
 if(relock?.LoadState!=='loaded')reasons.push('TASK183_INDEPENDENT_RELOCK_SERVICE_ABSENT');
 if(timer?.LoadState!=='loaded')reasons.push('TASK183_INDEPENDENT_RELOCK_TIMER_ABSENT');
 if(timer?.ActiveState!=='active'||timer?.UnitFileState!=='enabled')
   reasons.push('TASK183_RELOCK_TIMER_NOT_ACTIVE');
 if(!timer?.NextElapseUSecRealtime||['','n/a'].includes(timer.NextElapseUSecRealtime))
   reasons.push('TASK183_RELOCK_NEXT_RUN_NOT_PROVEN');
 return Object.freeze({
  scope:'CST-DEV_TASK183_HOST_ONLY',
  hostControls:reasons.length?'BLOCKED':'METADATA_PRESENT_UNATTESTED',
  reasons:Object.freeze(reasons),
  hostedRoleUnlockPermitted:false,
  corePreparationPermitted:false,
  dispatchPermitted:false,
  note:'This is not database authority attestation; a proven independent relock writer, bounded TTL and real trusted hosted security readback are still required.'
 });
}
export function inspectLocalRelockGate(){
 return assessLocalRelockGate({
  preparer:statusFromSystemd(PREPARER),
  relock:statusFromSystemd(RELOCK),
  timer:statusFromSystemd(TIMER)
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const result=inspectLocalRelockGate();
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.hostControls!=='METADATA_PRESENT_UNATTESTED')process.exitCode=2;
}
