import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const wrapper=await readFile(new URL('./gpt02-preparer-instruction-bound-wrapper-candidate.sql',import.meta.url),'utf8');
const sql=wrapper.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');

test('exact hosted wrapper contract: no new privilege, function, issuer or dispatch',()=>{
  assert.equal((sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/gi)??[]).length,1);
  assert.match(sql,/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+gpt02_stage\.prepare_core_task\s*\(/i);
  assert.match(sql,/SECURITY\s+DEFINER\s+SET\s+search_path\s+TO\s+'pg_catalog'/i);
  for(const forbidden of [
    /\bALTER\s+ROLE\b/i,/\bGRANT\b/i,/\bREVOKE\b/i,/\bCREATE\s+ROLE\b/i,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|COPY)\b/i,
    /\b(PERFORM|SELECT)\s+(?:submit|send|dispatch|issue_lease|consume_nonce)/i,
    /\bset_config\s*\(/i
  ])assert.doesNotMatch(sql,forbidden);
});

test('task, actor, source, and instruction are bound under one advisory lock',()=>{
  const required=[
    "session_user <> 'gpt02_core_prep_login'",
    'p_task <= 139',
    "p_company IS DISTINCT FROM 'default'",
    "p_repo IS DISTINCT FROM 'Travelintrips/Core-AI-Foundation'",
    'pg_advisory_xact_lock(',
    "t.id=p_task AND t.company_id=p_company",
    "t.status='new_inquiry'",
    "t.source='manual'",
    't.description=p_instruction',
    "t.title NOT ILIKE 'AI Core bridge command%'",
    "t.description NOT ILIKE 'AI Core bridge command%'",
    "t.description NOT ILIKE 'bridge-command:%'",
    "MESSAGE='PREPARATION_TASK_INSTRUCTION_NOT_BOUND'",
    'gpt02_stage.prepare_core_task_v1_internal(',
  ];
  for(const anchor of required)assert.ok(wrapper.includes(anchor),'MISSING '+anchor);
  assert.ok(wrapper.indexOf('pg_advisory_xact_lock')<wrapper.indexOf('t.description=p_instruction'));
  assert.ok(wrapper.indexOf('t.description=p_instruction')<
    wrapper.indexOf('prepare_core_task_v1_internal('));
});
