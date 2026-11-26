import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const path = new URL('../../deploy/hostinger/gpt02-issue159-reader-retry-readonly.conf',import.meta.url);
test('reader restart backoff survives temporary DB outage, does not touch credentials or dispatch',async()=>{
 const src=await readFile(path,'utf8');
 assert.match(src,/^\[Unit\]\nStartLimitIntervalSec=0$/m);
 assert.match(src,/^\[Service\]\nRestart=on-failure\nRestartSec=60s$/m);
 for(const forbidden of ['ExecStart','LoadCredential','EnvironmentFile','WantedBy',
   'SUPABASE_DATABASE_URL','Restart=always','OnFailure=','gpt02_core_prep_login'])
   assert.equal(src.includes(forbidden),false,forbidden);
});
