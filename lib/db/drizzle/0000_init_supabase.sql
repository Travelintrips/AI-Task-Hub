CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_id" integer,
	"assigned_role" text,
	"assigned_division" text,
	"assigned_vendor" text,
	"customer_name" text,
	"source_message_id" integer,
	"due_date" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"division" text,
	"is_vendor" text DEFAULT 'false',
	"is_active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"email" text,
	"avatar_url" text,
	"skills" text,
	"max_active_tasks" integer,
	"current_task_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"wamid" text,
	"from" text NOT NULL,
	"sender_phone" text,
	"sender_name" text,
	"body" text NOT NULL,
	"message_text" text,
	"message_type" text DEFAULT 'text' NOT NULL,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"attachment_url" text,
	"raw_payload" jsonb,
	"timestamp" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"ai_processed" boolean DEFAULT false NOT NULL,
	"detected_intent" text,
	"task_id" integer,
	"customer_id" integer,
	"ai_confidence" real,
	"sentiment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"file_url" text,
	"storage_path" text,
	"mime_type" text,
	"file_size" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"audit_summary" text,
	"audit_issues" text[] DEFAULT '{}' NOT NULL,
	"audit_score" integer,
	"task_id" integer,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"entity_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"task_number" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"customer_id" integer,
	"customer_name" text,
	"customer_phone" text,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"division" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'new_inquiry' NOT NULL,
	"assigned_to" text,
	"assigned_to_id" integer,
	"assigned_role" text,
	"assigned_division" text,
	"assigned_vendor" text,
	"driver_name" text,
	"driver_phone" text,
	"plate_number" text,
	"quotation_amount" text,
	"quotation_notes" text,
	"due_date" timestamp with time zone,
	"sla_hours" integer,
	"overdue_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"sla_status" text DEFAULT 'on_track' NOT NULL,
	"last_customer_reply_at" timestamp with time zone,
	"follow_up_count" integer DEFAULT 0 NOT NULL,
	"ai_summary" text,
	"ai_intent" text,
	"missing_data" text,
	"required_action" text,
	"admin_notes" text,
	"ai_confidence_score" text,
	"customer_sentiment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text,
	"object_path" text,
	"mime_type" text,
	"file_size" integer,
	"file_type" text,
	"document_type" text,
	"ocr_status" text DEFAULT 'pending',
	"extracted_text" text,
	"extracted_fields" jsonb,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"audit_status" text DEFAULT 'pending' NOT NULL,
	"complete_fields" text[] DEFAULT '{}' NOT NULL,
	"missing_fields" text[] DEFAULT '{}' NOT NULL,
	"mismatch_fields" text[] DEFAULT '{}' NOT NULL,
	"unclear_fields" text[] DEFAULT '{}' NOT NULL,
	"recommendation" text,
	"next_action" text,
	"audit_detail" jsonb,
	"cross_doc_detail" jsonb,
	"cross_doc_warnings" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"sender_type" text DEFAULT 'agent' NOT NULL,
	"sender_name" text,
	"comment" text NOT NULL,
	"attachment_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"assigned_to" text,
	"assigned_role" text,
	"assigned_division" text,
	"assigned_vendor" text,
	"assigned_by" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer,
	"company_id" text DEFAULT 'default' NOT NULL,
	"recipient_phone" text NOT NULL,
	"recipient_type" text DEFAULT 'customer' NOT NULL,
	"template_name" text,
	"message_text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_message_id" text,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"task_id" integer NOT NULL,
	"token_type" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "task_timeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"actor" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"company_name" text,
	"frequent_service" text,
	"special_notes" text,
	"previous_intents" text,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"last_active_task_id" integer,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"task_id" integer,
	"customer_phone" text,
	"customer_name" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"division" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"company_name" text,
	"company_phone" text,
	"company_address" text,
	"company_email" text,
	"industry_type" text,
	"logo_url" text,
	"timezone" text DEFAULT 'Asia/Jakarta',
	"fonnte_token" text,
	"whatsapp_phone_number_id" text,
	"whatsapp_token" text,
	"whatsapp_webhook_verify_token" text,
	"template_missing_doc" text,
	"template_new_task" text,
	"template_assignment" text,
	"template_progress" text,
	"template_approval" text,
	"template_completed" text,
	"openai_model" text DEFAULT 'gpt-4o-mini',
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"dispatcher_enabled" boolean DEFAULT false NOT NULL,
	"auto_assign_enabled" boolean DEFAULT false NOT NULL,
	"follow_up_enabled" boolean DEFAULT true NOT NULL,
	"follow_up_interval_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"customer_code" text,
	"company_name" text NOT NULL,
	"pic_name" text,
	"pic_phone" text,
	"whatsapp" text,
	"email" text,
	"npwp" text,
	"address" text,
	"notes" text,
	"industry" text,
	"tier" text DEFAULT 'regular',
	"payment_terms" text,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"ai_summary" text,
	"last_task_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"task_type" text DEFAULT 'ai_task' NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"item_name" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"quotation_number" text,
	"task_id" integer,
	"customer_id" integer,
	"customer_name" text,
	"customer_phone" text,
	"title" text NOT NULL,
	"description" text,
	"freight_cost" real DEFAULT 0,
	"customs_cost" real DEFAULT 0,
	"trucking_cost" real DEFAULT 0,
	"handling_cost" real DEFAULT 0,
	"other_charges" real DEFAULT 0,
	"total_amount" real DEFAULT 0,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"ai_generated" text,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"user_id" integer,
	"user_name" text,
	"user_email" text,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"entity_id" integer,
	"entity_type" text,
	"before" text,
	"after" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tracking_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"event_code" text,
	"event_description" text NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_trackings" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"tracking_type" text DEFAULT 'container' NOT NULL,
	"tracking_number" text,
	"carrier_name" text,
	"vessel_name" text,
	"voyage_number" text,
	"port_of_loading" text,
	"port_of_discharge" text,
	"etd" timestamp with time zone,
	"eta" timestamp with time zone,
	"atd" timestamp with time zone,
	"ata" timestamp with time zone,
	"current_status" text,
	"current_location" text,
	"last_updated_at" timestamp with time zone,
	"raw_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"customer_phone" text,
	"customer_name" text,
	"follow_up_number" integer DEFAULT 1 NOT NULL,
	"message" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"is_success" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatcher_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"task_id" integer NOT NULL,
	"task_number" text,
	"task_title" text,
	"task_category" text,
	"task_priority" text,
	"task_sla_status" text,
	"suggested_member_id" integer,
	"suggested_member_name" text,
	"suggested_member_role" text,
	"suggested_member_division" text,
	"assigned_member_name" text,
	"was_overridden" boolean DEFAULT false,
	"override_reason" text,
	"total_score" real,
	"workload_score" real,
	"skill_score" real,
	"urgency_score" real,
	"availability_score" real,
	"explanation" text,
	"all_candidates_json" text,
	"dispatched_by" text,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_master" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"intent_code" text NOT NULL,
	"intent_name" text NOT NULL,
	"category" text,
	"description" text,
	"suggested_category" text,
	"suggested_division" text,
	"suggested_priority" text DEFAULT 'medium',
	"sla_hours" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"keyword" text NOT NULL,
	"intent_code" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"service_code" text,
	"service_name" text NOT NULL,
	"category" text,
	"description" text,
	"base_price" text,
	"currency" text DEFAULT 'IDR',
	"estimated_days" text,
	"sla_hours" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_template_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"help_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_template_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"document_name" text NOT NULL,
	"document_type" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_priority_idx" ON "tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "tasks_created_at_idx" ON "tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "team_members_company_idx" ON "team_members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "team_members_division_idx" ON "team_members" USING btree ("division");--> statement-breakpoint
CREATE INDEX "wa_messages_sender_phone_idx" ON "whatsapp_messages" USING btree ("sender_phone");--> statement-breakpoint
CREATE INDEX "wa_messages_from_idx" ON "whatsapp_messages" USING btree ("from");--> statement-breakpoint
CREATE INDEX "wa_messages_task_id_idx" ON "whatsapp_messages" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "wa_messages_customer_id_idx" ON "whatsapp_messages" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "wa_messages_processed_idx" ON "whatsapp_messages" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "wa_messages_created_at_idx" ON "whatsapp_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_wamid_idx" ON "whatsapp_messages" USING btree ("wamid");--> statement-breakpoint
CREATE INDEX "ai_tasks_company_status_idx" ON "ai_tasks" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "ai_tasks_customer_phone_idx" ON "ai_tasks" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "ai_tasks_customer_id_idx" ON "ai_tasks" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ai_tasks_assigned_to_id_idx" ON "ai_tasks" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "ai_tasks_status_idx" ON "ai_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_tasks_category_idx" ON "ai_tasks" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ai_tasks_division_idx" ON "ai_tasks" USING btree ("division");--> statement-breakpoint
CREATE INDEX "ai_tasks_created_at_idx" ON "ai_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "task_attach_task_id_idx" ON "task_attachments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_attach_ocr_status_idx" ON "task_attachments" USING btree ("ocr_status");--> statement-breakpoint
CREATE INDEX "doc_audits_task_id_idx" ON "document_audits" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "doc_audits_status_idx" ON "document_audits" USING btree ("audit_status");--> statement-breakpoint
CREATE INDEX "customer_ctx_phone_company_idx" ON "customer_contexts" USING btree ("phone","company_id");--> statement-breakpoint
CREATE INDEX "customer_ctx_phone_idx" ON "customer_contexts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "admin_notif_company_idx" ON "admin_notifications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "admin_notif_is_read_idx" ON "admin_notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "admin_notif_company_read_idx" ON "admin_notifications" USING btree ("company_id","is_read");--> statement-breakpoint
CREATE INDEX "customers_company_idx" ON "customers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "customers_whatsapp_idx" ON "customers" USING btree ("whatsapp");--> statement-breakpoint
CREATE INDEX "customers_company_name_idx" ON "customers" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX "checklists_task_idx" ON "operational_checklists" USING btree ("task_id","task_type");--> statement-breakpoint
CREATE INDEX "checklists_company_idx" ON "operational_checklists" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "quotations_company_idx" ON "quotations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "quotations_task_idx" ON "quotations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "quotations_status_idx" ON "quotations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotations_customer_idx" ON "quotations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "audit_logs_company_idx" ON "audit_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_module_idx" ON "audit_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "shipment_events_tracking_idx" ON "shipment_events" USING btree ("tracking_id");--> statement-breakpoint
CREATE INDEX "shipment_events_task_idx" ON "shipment_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "shipment_task_idx" ON "shipment_trackings" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "shipment_tracking_number_idx" ON "shipment_trackings" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "follow_up_task_idx" ON "follow_up_logs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "follow_up_company_idx" ON "follow_up_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "intent_master_company_idx" ON "intent_master" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "intent_master_code_idx" ON "intent_master" USING btree ("intent_code");--> statement-breakpoint
CREATE INDEX "keyword_rules_company_idx" ON "keyword_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "keyword_rules_intent_idx" ON "keyword_rules" USING btree ("intent_code");--> statement-breakpoint
CREATE INDEX "service_catalog_company_idx" ON "service_catalog" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "service_catalog_category_idx" ON "service_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "data_template_fields_template_idx" ON "data_template_fields" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "data_templates_company_idx" ON "data_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "document_template_fields_template_idx" ON "document_template_fields" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "document_templates_company_idx" ON "document_templates" USING btree ("company_id");