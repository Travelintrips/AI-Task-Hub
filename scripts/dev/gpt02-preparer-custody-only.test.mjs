import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const unit=readFileSync(new URL('../../deploy/systemd/gpt02-core-preparer.service',import.meta.url),'utf8');
const code=readFileSync(new URL('./gpt02-preparer-custody-only.mjs',import.meta.url),'utf8');
test('locked by default: no install and manual starts refused',()=>{
 assert.match(unit,/^RefuseManualStart=yes$/m);
 assert.doesNotMatch(unit,/^\[Install\]$/m);
 assert.doesNotMatch(unit,/^WantedBy=/m);
 assert.doesNotMatch(unit,/^Restart=(?:always|on-failure)/m);
});
test('strict separate encrypted credential never reuses issue159, shared or PROD DSN',()=>{
 assert.match(unit,/^LoadCredentialEncrypted=preparer-dsn:\/etc\/credstore\.encrypted\/gpt02-task183-preparer-dsn$/m);
 assert.match(unit,/^ConditionPathExists=\/etc\/credstore\.encrypted\/gpt02-task183-preparer-dsn$/m);
 assert.doesNotMatch(unit,/gpt02-issue159-core-prep-dsn|SUPABASE_DATABASE_URL_DEV|postgres:\/\//);
 assert.match(unit,/^DynamicUser=yes$/m);
});
test('networkless non-root one-shot and immutable host boundaries',()=>{
 for(const expected of ['Type=oneshot','PrivateNetwork=yes','NoNewPrivileges=yes','ProtectSystem=strict',
    'ProtectHome=yes','CapabilityBoundingSet=','RestrictAddressFamilies=AF_UNIX'])assert.ok(unit.includes(expected));
 assert.doesNotMatch(unit,/^User=root$/m);
});
test('entrypoint never connects or prepares and never prints credentials',()=>{
 assert.match(code,/corePreparationPoolConfigFromFiles/);
 for(const forbidden of ['new Pool(','.connect(','.prepare(','.query(','process.env.SUPABASE_DATABASE_URL_DEV','console.log(c.connectionString)'])
  assert.ok(!code.includes(forbidden),forbidden);
 assert.match(code,/databaseConnectionAttempted:false/);
 assert.match(code,/dispatchPermitted:false/);
});

test('runtime requires pinned Node 22 binary and both immutable entrypoint files',()=>{
 assert.match(unit,/^ExecStart=\/opt\/actions-runner\/_work\/_tool\/node\/22\.23\.3\/x64\/bin\/node \/opt\/ai-task-gpt02-preparer\/current\/scripts\/dev\/gpt02-preparer-custody-only\.mjs$/m);
 assert.match(unit,/^ConditionPathExists=\/opt\/actions-runner\/_work\/_tool\/node\/22\.23\.3\/x64\/bin\/node$/m);
 assert.match(unit,/^ConditionPathExists=\/opt\/ai-task-gpt02-preparer\/current\/scripts\/dev\/gpt02-preparer-custody-only\.mjs$/m);
 assert.match(unit,/^ConditionPathExists=\/opt\/ai-task-gpt02-preparer\/current\/artifacts\/api-server\/src\/lib\/gpt02-core-task-preparation\.mjs$/m);
 assert.doesNotMatch(unit,/ExecStart=\/usr\/bin\/env node/);
});
