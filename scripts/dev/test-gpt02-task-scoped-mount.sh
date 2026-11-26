#!/usr/bin/env bash
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
bundle=$(mktemp -d)
trap 'chmod 700 "$bundle" && rm -rf "$bundle"' EXIT
uid=$(id -u)
gid=$(id -g)
if [[ $uid == 0 ]]; then uid=65534; gid=65534; fi
cp "$root/scripts/dev/fixtures/supabase-root-ca-2021.crt" "$bundle/supabase-root-ca.crt"
cat > "$bundle/task-preparer.json" <<'JSON'
{"companyId":"default","taskId":189,"connectionString":"postgresql://gpt02_core_prep_login.xssrfshdrtdfupgqwfdw:synthetic-only@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"}
JSON
chmod 0400 "$bundle"/*
if [[ $(id -u) == 0 ]]; then chown -R "$uid:$gid" "$bundle"; fi
chmod 0500 "$bundle"
docker run --rm -i --network none --read-only --user "$uid:$gid" \
  --mount "type=bind,src=$bundle,dst=/run/credentials/gpt02-task-preparer.service,readonly" \
  --mount "type=bind,src=$root/artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs,dst=/tmp/preparer.mjs,readonly" \
  --entrypoint node "${GPT02_TEST_NODE_IMAGE:-node:24-bookworm-slim}" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {createCoreTaskPreparer} from '/tmp/preparer.mjs';
const ref='xssrfshdrtdfupgqwfdw';
const env={NODE_ENV:'development',APP_ENV:'development',GPT02_CORE_PREPARATION_ENABLED:'true',
 GPT02_CORE_PREP_CREDENTIAL_SOURCE:'docker-task-scoped',GPT02_CORE_PREP_DEV_PROJECT_REF:ref,
 GPT02_HUB_DEV_PROJECT_REF:ref,GPT02_PROD_PROJECT_REF:'p'.repeat(20),
 GPT02_CORE_PREP_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com'};
let pools=0;
class Pool {
 constructor(config){
  assert.equal(config.ssl.rejectUnauthorized,true);
  assert.equal(config.max,1);
  pools++;
 }
 on(){}
 connect(){assert.fail('scope rejection must precede a database connection');}
 end(){}
}
const make=(taskId,patch={})=>createCoreTaskPreparer({env:{...env,...patch},taskId,PoolClass:Pool});
for(const id of [183,190,undefined,'189',0]){
 assert.throws(()=>make(id),{code:'GPT02_PREPARER_TASK_SCOPE_MISMATCH'});
}
assert.throws(()=>make(189,{GPT02_CORE_PREP_DATABASE_URL_DEV:'synthetic-inline'}),{code:'PREPARER_INLINE_CREDENTIAL_FORBIDDEN'});
assert.throws(()=>make(189,{GPT02_CORE_PREP_CREDENTIAL_SOURCE:'docker-readonly'}),{code:'PREPARER_DOCKER_READONLY_MOUNT_REQUIRED'});
assert.equal(pools,0);
const service=make(189);
assert.equal(pools,1);
await assert.rejects(service.preparer.prepare({companyId:'default',hubTaskId:183,
 projectName:'GPT02 DEV coding lifecycle',repository:'Travelintrips/Core-AI-Foundation',
 branch:'develop',instruction:'Fixture only'}),{code:'GPT02_PREPARER_TASK_SCOPE_MISMATCH'});
await service.close();
console.log('TASK_SCOPED_MOUNT_PASS');
JS
