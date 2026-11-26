-- Run through an authenticated CST-DEV custody session. Return only the
-- recipient-encrypted package for a live grant already issued for this request.
WITH request_data AS MATERIALIZED (
  SELECT decrypted_secret::jsonb AS descriptor
  FROM vault.decrypted_secrets
  WHERE name = 'gpt02-task189-prepare-request-1bdbed20-ac8d-4e63-898e-6a94b729c018'
), grant_data AS MATERIALIZED (
  SELECT decrypted_secret::jsonb AS grant_record
  FROM vault.decrypted_secrets
  WHERE name = 'gpt02-task189-prepare-grant-1bdbed20-ac8d-4e63-898e-6a94b729c018'
), recipient AS (
  SELECT descriptor, grant_record, r.rolvaliduntil
  FROM request_data CROSS JOIN grant_data
  JOIN pg_catalog.pg_roles r ON r.rolname = 'gpt02_core_prep_login'
  WHERE descriptor->>'requestId' = '1bdbed20-ac8d-4e63-898e-6a94b729c018'
    AND descriptor->>'fingerprint' = 'FA20AA396CFA6885F58CB0F222C90A3543B078E9'
    AND encode(sha256(convert_to(descriptor->>'publicKey','UTF8')),'hex') = 'eab4d2dce5686732f7bb761733d6d2fec41e2f6b804cabc511d382d198f4f600'
    AND descriptor->'scope' = '{"companyId":"default","taskId":189,"project":"xssrfshdrtdfupgqwfdw","purpose":"prepare-only"}'::jsonb
    AND grant_record->>'requestId' = descriptor->>'requestId'
    AND grant_record->'scope' = descriptor->'scope'
    AND grant_record->>'role' = r.rolname
    AND grant_record->>'kind' = 'lease'
    AND jsonb_typeof(grant_record->'password') = 'string'
    AND octet_length(grant_record->>'password') BETWEEN 1 AND 1024
    AND r.rolcanlogin AND r.rolconnlimit = 1
    AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
    AND r.rolvaliduntil > clock_timestamp()
    AND r.rolvaliduntil <= clock_timestamp() + interval '180 seconds'
    AND grant_record->'expiresAt' = to_jsonb(floor(extract(epoch FROM r.rolvaliduntil))::bigint)
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc f
      WHERE f.oid=to_regprocedure('gpt02_stage.prepare_core_task(text,integer,text,text,text,text)')
        AND f.prosecdef AND pg_get_userbyid(f.proowner)='gpt02_core_prep_owner'
        AND f.proconfig=ARRAY['search_path=pg_catalog']
        AND pg_catalog.obj_description(f.oid,'pg_proc') =
            'GPT02 DEV prepare-only task 189 request 1bdbed20-ac8d-4e63-898e-6a94b729c018'
        AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='2d0461518f6992c1b404bc44f14c5556f172a1dace2f3bd37ffafe123285f0c3'
        AND has_function_privilege(r.oid,f.oid,'EXECUTE')
        AND NOT EXISTS (
          SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
          WHERE a.grantee NOT IN (f.proowner,r.oid) OR (a.grantee=r.oid AND a.is_grantable)
        )
        AND has_schema_privilege(r.oid,f.pronamespace,'USAGE')
        AND NOT has_schema_privilege(r.oid,f.pronamespace,'CREATE')
        AND NOT EXISTS (
          SELECT 1 FROM pg_proc other JOIN pg_namespace ns ON ns.oid=other.pronamespace
          WHERE ns.nspname IN ('gpt02_stage','gpt02_private') AND other.oid<>f.oid
            AND has_function_privilege(r.oid,other.oid,'EXECUTE')
        )
    )
    AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES ('public','ai_tasks'),('public','team_members'),('public','audit_logs'),
                   ('public','users'),('public','ai_execution_jobs'),('gpt02_stage','core_preparations'),
                   ('ai_platform','ai_coding_tasks'),('ai_platform','ai_coding_runs'),
                   ('ai_platform','ai_coding_bridge_commands')) expected(schema_name,table_name)
      LEFT JOIN pg_namespace ns ON ns.nspname=expected.schema_name
      LEFT JOIN pg_class rel ON rel.relnamespace=ns.oid AND rel.relname=expected.table_name
      WHERE rel.oid IS NULL OR rel.relkind NOT IN ('r','p') OR NOT rel.relrowsecurity
        OR has_table_privilege(r.oid,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(r.oid,rel.oid,'SELECT,INSERT,UPDATE,REFERENCES')
    )
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid)
)
SELECT replace(encode(extensions.pgp_pub_encrypt(jsonb_build_object(
  'requestId',descriptor->>'requestId', 'scope',descriptor->'scope', 'kind','lease',
  'role','gpt02_core_prep_login', 'expiresAt',floor(extract(epoch FROM rolvaliduntil))::bigint,
  'password',grant_record->>'password')::text, extensions.dearmor(descriptor->>'publicKey'),
  'cipher-algo=aes256'),'base64'),chr(10),'') AS encrypted_package
FROM recipient;
