import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const src=await readFile(new URL('./gpt02-native-reader-proof-once.sh',import.meta.url),'utf8');

test('one-shot reader proof has mandatory fail-closed relock and secret cleanup',()=>{
  for(const required of [
    'set -euo pipefail','umask 077','mktemp /run/gpt02-native-reader-proof.',
    'chmod 600 "$SECRET_ENV"','trap cleanup EXIT HUP INT TERM',
    'ALTER ROLE gpt02_hub_evidence_reader NOLOGIN CONNECTION LIMIT 0',
    'ALTER ROLE gpt02_core_evidence_reader NOLOGIN CONNECTION LIMIT 0',
    'openssl rand -hex 32','roles_locked=0','lock_roles',
    'TWO_NATIVE_READERS_PASS_NO_AUTHORITY',
    'GPT02_NATIVE_TWO_READER_PROOF=PASS_RELOCKED_NO_AUTHORITY'
  ]) assert.ok(src.includes(required),required);
});

test('script opens only the two evidence readers and never authority roles or PROD',()=>{
  assert.match(src,/ALTER ROLE gpt02_hub_evidence_reader LOGIN CONNECTION LIMIT 1/);
  assert.match(src,/ALTER ROLE gpt02_core_evidence_reader LOGIN CONNECTION LIMIT 1/);
  for(const forbidden of [
    'dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence',
    'SUPABASE_DATABASE_URL_PROD','production.env',
    'Task #135','Task #136','dispatchPermitted:true',
    'issuerLeaseGranted:true','taskCreated:true','commandCreated:true'
  ]) assert.equal(src.includes(forbidden),false,forbidden);
});

test('script never persists or prints generated reader passwords',()=>{
  for(const forbidden of [
    'set -x','echo "$HUB_PASS"','echo "$CORE_PASS"',
    'cat "$SECRET_ENV"','>> /etc/ai-task/development.env',
    '> /etc/ai-task/development.env','tee /etc/ai-task/development.env'
  ]) assert.equal(src.includes(forbidden),false,forbidden);
  assert.match(src,/rm -f "\\$SECRET_ENV"/);
  assert.match(src,/unset HUB_PASS CORE_PASS/);
});

test('baseline and final state both require NOLOGIN limit0 zero memberships/sessions',()=>{
  assert.match(src,/EXPECTED="gpt02_core_evidence_reader\|false\|0\|0\|0;gpt02_hub_evidence_reader\|false\|0\|0\|0"/);
  assert.match(src,/[ "$BASELINE" = "$EXPECTED" ]/);
  assert.match(src,/[ "$AFTER" = "$EXPECTED" ]/);
});
