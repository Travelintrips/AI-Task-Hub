-- CST DEV only: exact column-level SELECT grants for GPT02 evidence readers.
-- No mutating privileges, no PUBLIC grants, no broad table-level SELECT.

REVOKE SELECT ON gpt02_stage.core_preparations FROM gpt02_hub_evidence_reader;
REVOKE SELECT ON gpt02_private.operator_links FROM gpt02_hub_evidence_reader;
REVOKE SELECT ON gpt02_private.approvals FROM gpt02_hub_evidence_reader;
REVOKE SELECT ON public.ai_tasks FROM gpt02_hub_evidence_reader;
REVOKE SELECT ON public.team_members FROM gpt02_hub_evidence_reader;
REVOKE SELECT ON public.users FROM gpt02_hub_evidence_reader;
REVOKE SELECT ON public.audit_logs FROM gpt02_hub_evidence_reader;
REVOKE SELECT ON public.ai_execution_jobs FROM gpt02_hub_evidence_reader;

REVOKE SELECT ON ai_platform.ai_coding_tasks FROM gpt02_core_evidence_reader;
REVOKE SELECT ON ai_platform.internal_users FROM gpt02_core_evidence_reader;
REVOKE SELECT ON ai_platform.ai_coding_runs FROM gpt02_core_evidence_reader;
REVOKE SELECT ON ai_platform.ai_coding_bridge_commands FROM gpt02_core_evidence_reader;

GRANT SELECT (company_id,hub_task_id,member_id,member_audit_id,operator_subject,core_task_id,hub_execution_id,command_candidate_id,attempt_id,config_sha256,expires_at)
ON gpt02_stage.core_preparations TO gpt02_hub_evidence_reader;

GRANT SELECT (link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,company_id,assignee_id,accountable_owner_id,hub_operator_id,core_operator_user_id,approval_digest,link_digest,hub_signature,core_signature,claims)
ON gpt02_private.operator_links TO gpt02_hub_evidence_reader;

GRANT SELECT (command_id,task_id,company_id,approver_id,claims,signature,digest)
ON gpt02_private.approvals TO gpt02_hub_evidence_reader;

GRANT SELECT (id,company_id,assigned_to_id,assigned_to,status,title)
ON public.ai_tasks TO gpt02_hub_evidence_reader;

GRANT SELECT (id,company_id,name,is_active)
ON public.team_members TO gpt02_hub_evidence_reader;

GRANT SELECT (id,role,is_active,status,company_id,email)
ON public.users TO gpt02_hub_evidence_reader;

GRANT SELECT (id,company_id,action,entity_id,after,user_email)
ON public.audit_logs TO gpt02_hub_evidence_reader;

GRANT SELECT (id,company_id,task_id,status,source,external_id,idempotency_key,title,instruction,progress,callback_verified,attestation_verified,final_ack_verified,command_id,worker_id,assigned_client_id,metadata)
ON public.ai_execution_jobs TO gpt02_hub_evidence_reader;

GRANT SELECT (id,status,task_number,project_name,repository,branch,instruction)
ON ai_platform.ai_coding_tasks TO gpt02_core_evidence_reader;

GRANT SELECT (id,email,role,status,must_change_password)
ON ai_platform.internal_users TO gpt02_core_evidence_reader;

GRANT SELECT (task_id)
ON ai_platform.ai_coding_runs TO gpt02_core_evidence_reader;

GRANT SELECT (task_id)
ON ai_platform.ai_coding_bridge_commands TO gpt02_core_evidence_reader;
