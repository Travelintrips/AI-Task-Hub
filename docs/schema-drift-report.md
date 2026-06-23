# Schema Drift Report
_Generated: 2026-06-23T06:18:24.629Z_

## Summary
| Issue | Count |
|---|---|
| Tables missing in DB | 16 |
| Columns missing in DB | 22 |
| Type mismatches (HIGH) | 26 |
| Extra cols in DB (INFO) | 548 |

## 🔴 Type Mismatches (HIGH Priority)
| Table | Column | Drizzle Type | Actual DB Type | Impact |
|---|---|---|---|---|
| audit_logs | entity_id | integer | text | ⚠️ Potential data issues |
| customer_memory_snapshots | last_n_intents | text | ARRAY | ⚠️ Potential data issues |
| customer_memory_snapshots | missing_docs_list | text | ARRAY | ⚠️ Potential data issues |
| customer_memory_snapshots | frequent_services | text | ARRAY | ⚠️ Potential data issues |
| customers | company_id | text | integer | ⚠️ Query will fail with type cast error |
| document_audits | complete_fields | text | ARRAY | ⚠️ Potential data issues |
| document_audits | missing_fields | text | ARRAY | ⚠️ Potential data issues |
| document_audits | mismatch_fields | text | ARRAY | ⚠️ Potential data issues |
| document_audits | unclear_fields | text | ARRAY | ⚠️ Potential data issues |
| document_audits | cross_doc_warnings | text | ARRAY | ⚠️ Potential data issues |
| document_validation_rules | required_fields | text | ARRAY | ⚠️ Potential data issues |
| document_validation_rules | optional_fields | text | ARRAY | ⚠️ Potential data issues |
| document_validation_rules | is_active | text | boolean | ⚠️ Potential data issues |
| documents | audit_issues | text | ARRAY | ⚠️ Potential data issues |
| approval_rules | company_id | text | integer | ⚠️ Query will fail with type cast error |
| approval_requests | company_id | text | integer | ⚠️ Query will fail with type cast error |
| intel_readiness_scores | top_flags | text | ARRAY | ⚠️ Potential data issues |
| users | id | serial | text | ⚠️ Potential data issues |
| users | company_id | text | integer | ⚠️ Query will fail with type cast error |
| vendor_capabilities | origin_cities | text | ARRAY | ⚠️ Potential data issues |
| vendor_capabilities | destination_cities | text | ARRAY | ⚠️ Potential data issues |
| vendor_capabilities | vehicle_types | text | ARRAY | ⚠️ Potential data issues |
| vendor_capabilities | certifications | text | ARRAY | ⚠️ Potential data issues |
| vendor_memory_snapshots | top_service_types | text | ARRAY | ⚠️ Potential data issues |
| vendor_memory_snapshots | best_routes | text | ARRAY | ⚠️ Potential data issues |
| vendor_memory_snapshots | missing_docs_list | text | ARRAY | ⚠️ Potential data issues |

## 🟠 Columns Missing in DB (Schema Drift)
| Table | Column | Drizzle Type | Fix |
|---|---|---|---|
| approval_rules | intent_code | text | Run DB migration or remove from schema |
| approval_rules | category | text | Run DB migration or remove from schema |
| approval_rules | priority | text | Run DB migration or remove from schema |
| approval_rules | approval_type | text | Run DB migration or remove from schema |
| approval_rules | approver_role | text | Run DB migration or remove from schema |
| approval_rules | requires_note | boolean | Run DB migration or remove from schema |
| approval_rules | timeout_hours | integer | Run DB migration or remove from schema |
| approval_requests | task_id | integer | Run DB migration or remove from schema |
| approval_requests | rule_id | integer | Run DB migration or remove from schema |
| approval_requests | approver_role | text | Run DB migration or remove from schema |
| approval_requests | approval_type | text | Run DB migration or remove from schema |
| approval_requests | decided_by | text | Run DB migration or remove from schema |
| approval_requests | decided_at | timestamp | Run DB migration or remove from schema |
| task_attachments | customer_id | integer | Run DB migration or remove from schema |
| task_attachments | is_reusable | boolean | Run DB migration or remove from schema |
| task_attachments | reuse_notes | text | Run DB migration or remove from schema |
| prompt_versions | version_label | text | Run DB migration or remove from schema |
| prompt_versions | prompt_diff | text | Run DB migration or remove from schema |
| prompt_versions | changelog | text | Run DB migration or remove from schema |
| prompt_versions | parent_version_id | integer | Run DB migration or remove from schema |
| prompt_versions | experiment_id | integer | Run DB migration or remove from schema |
| prompt_versions | accuracy_at_activation | numeric | Run DB migration or remove from schema |

## 🔴 Tables Missing in DB
- `routing_rules` — in Drizzle schema but not in Supabase DB
- `sla_matrix` — in Drizzle schema but not in Supabase DB
- `escalation_rules` — in Drizzle schema but not in Supabase DB
- `escalation_logs` — in Drizzle schema but not in Supabase DB
- `correction_queue` — in Drizzle schema but not in Supabase DB
- `correction_sessions` — in Drizzle schema but not in Supabase DB
- `training_dataset` — in Drizzle schema but not in Supabase DB
- `dataset_exports` — in Drizzle schema but not in Supabase DB
- `accuracy_snapshots` — in Drizzle schema but not in Supabase DB
- `prompt_test_results` — in Drizzle schema but not in Supabase DB
- `ai_experiments` — in Drizzle schema but not in Supabase DB
- `experiment_observations` — in Drizzle schema but not in Supabase DB
- `experiment_results` — in Drizzle schema but not in Supabase DB
- `prediction_logs` — in Drizzle schema but not in Supabase DB
- `performance_daily` — in Drizzle schema but not in Supabase DB
- `performance_by_intent` — in Drizzle schema but not in Supabase DB

## Company ID Type Audit
Tables with `company_id` that DIFFER from Drizzle TEXT schema:

| Table | DB Type | Drizzle Type |
|---|---|---|
| customers | integer | text |
| approval_rules | integer | text |
| approval_requests | integer | text |
| users | integer | text |
