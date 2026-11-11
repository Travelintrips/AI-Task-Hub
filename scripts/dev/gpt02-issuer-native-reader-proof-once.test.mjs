import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const src=await readFile(new URL('./gpt02-issuer-native-reader-proof-once.sh',import.meta.url),'utf8');

test('issuer reader proof is one-shot, fail-closed and always relocks',()=>{
  for(const required of [
    'set -euo pipefail','umask 077','mktemp /run/gpt02-issuer-reader-proof.',
    'chmod 600 "$SECRET_ENV"','trap cleanup EXIT HUP INT TERM',
    'ALTER ROLE gpt02_issuer_evidence_reader LOGIN CONNECTION LIMIT 1',
    'ALTER ROLE gpt02_issuer_evidence_reader NOLOGIN CONNECTION LIMIT 0',
    'pg_terminate_backend(pid)','READER_RELOCK_COMMAND_FAILED',
    'openssl rand -hex 32','ISSUER_NATIVE_READER_PASS_NO_AUTHORITY',
    'GPT02_ISSUER_NATIVE_READER_PROOF=PASS_RELOCKED_NO_AUTHORITY'
  ])assert.ok(src.includes(required),required);
});

test('proof validates only read-only private evidence surface and no authority roles',()=>{
  for(const required of [
    'BEGIN READ ONLY',
    'select_columns===32',
    'policy_count===3',
    'gpt02_private.receipts LIMIT 0',
    'gpt02_private.core_identity_receipts LIMIT 0',
    'gpt02_private.post_consumption_fences LIMIT 0',
    'signingPermitted:false',
    'authorizationGranted:false',
    'dispatchPermitted:false',
    "releaseDecision:'NO_GO'"
  ])assert.ok(src.includes(required),required);
  for(const forbidden of [
    'dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence',
    'SUPABASE_DATABASE_URL_PROD','production.env',
    'dispatchPermitted:true','signingPermitted:true',
    'authorizationGranted:true','taskCreated:true','commandCreated:true'
  ])assert.equal(src.includes(forbidden),false,forbidden);
});

test('password never persists or prints',()=>{
  for(const forbidden of [
    'set -x','echo "$PASS"','cat "$SECRET_ENV"',
    '>> /etc/ai-task/development.env','> /etc/ai-task/development.env',
    'tee /etc/ai-task/development.env'
  ])assert.equal(src.includes(forbidden),false,forbidden);
  assert.ok(src.includes('rm -f "$SECRET_ENV"'));
  assert.ok(src.includes('unset PASS GPT02_ISSUER_READER_DATABASE_URL_DEV'));
});

test('baseline and final state both require NOLOGIN limit0 zero memberships/sessions',()=>{
  assert.ok(src.includes('[ "$BASELINE" = "false|0|0|0" ]'));
  assert.ok(src.includes('[ "$AFTER" = "false|0|0|0" ]'));
});
