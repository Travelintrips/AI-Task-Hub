/**
 * DEV-only one-shot custody preflight. Never instantiate a DB pool, prepare a
 * task, start a worker or acquire lease. Returns only nonsecret booleans.
 */
import {corePreparationPoolConfigFromFiles} from '../../artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs';
function fail(){process.stdout.write(JSON.stringify({ready:false,dispatchPermitted:false})+'\n');process.exitCode=2;}
try {
 if(process.env.GPT02_CORE_PREPARATION_ENABLED==='true')throw Error('PREPARATION_FLAG_ON');
 if(process.env.GPT02_CORE_PREP_CREDENTIAL_SOURCE!=='systemd')throw Error('CUSTODY_SOURCE_INVALID');
 const c=corePreparationPoolConfigFromFiles(process.env);
 if(c.max!==1||c.ssl?.rejectUnauthorized!==true||
    c.application_name!=='gpt02-core-preparation-DEV-only')throw Error('CUSTODY_SCOPE_INVALID');
 process.stdout.write(JSON.stringify({ready:true,credentialsConfigured:true,pinnedTLS:true,maxOne:true,
  databaseConnectionAttempted:false,preparationAttempted:false,dispatchPermitted:false})+'\n');
}catch{fail();}
