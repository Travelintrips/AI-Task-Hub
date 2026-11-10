#!/usr/bin/env node
/** Read-only inventory of the existing AI Task DEV Docker container.
 * Never retrieves credential values, queries rows, flips flags, or deploys.
 * No source tests can turn this inventory into permission to resume GPT02.
 */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function evaluateBridgeReadbackRuntime(facts){
 const image=typeof facts.image==='string'?facts.image:null;
 const routeInstalled=facts.routeInstalled===true;
 const enabled=facts.enabled===true;
 const checks=[
  {id:'DEV_CONTAINER_IMAGE',ok:!!image,detail:image||'UNAVAILABLE'},
  {id:'READBACK_ROUTE_INSTALLED',ok:routeInstalled,detail:routeInstalled?'FOUND':'MISSING_OR_UNAVAILABLE'},
  {id:'DEV_READBACK_FLAG_ENABLED',ok:enabled,detail:enabled?'ENABLED':'NOT_ENABLED'},
 ];
 return {environment:'DEV',container:'ai-task-development',readOnly:true,
  status:checks.every(x=>x.ok)?'READY_FOR_AUTHENTICATED_READBACK_DRILL':'BLOCKED',
  actualReadbackVerified:false,mayIssueGrant:false,mayDispatchWorker:false,
  releaseDecision:'NO_GO',checks};
}
function docker(...args){
 return execFileSync('docker',args,{encoding:'utf8',timeout:5000,maxBuffer:65536}).trim();
}
export function inspectDevContainer(){
 const container='ai-task-development';
 const image=docker('inspect','--format','{{.Config.Image}}',container);
 const probe=docker('exec',container,'sh','-c',[
  'if [ "${NODE_ENV:-}" = production ]; then echo production_runtime; exit 0; fi',
  'if [ "${AI_TASK_BRIDGE_READBACK_ENABLED:-}" = true ]; then echo flag_enabled; else echo flag_disabled; fi',
  'if grep -R -l -m1 "by-external-id" /app/artifacts/api-server/dist 2>/dev/null | grep -q .; then echo route_installed; else echo route_absent; fi',
 ].join('; '));
 const lines=probe.split('\n');
 if(lines.includes('production_runtime'))throw new Error('WRONG_ENVIRONMENT');
 return {image,enabled:lines.includes('flag_enabled'),routeInstalled:lines.includes('route_installed')};
}
function main(){
 try{
  const report=evaluateBridgeReadbackRuntime(inspectDevContainer());
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status!=='READY_FOR_AUTHENTICATED_READBACK_DRILL')process.exitCode=3;
 }catch{
  process.stdout.write(JSON.stringify(evaluateBridgeReadbackRuntime({}),null,2)+'\n');
  process.exitCode=3;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
