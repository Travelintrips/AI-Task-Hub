/**
 * Sprint 4B — AI Training & Feedback Loop
 * 13 tables: correction_queue, correction_sessions, training_dataset,
 * dataset_exports, accuracy_snapshots, prompt_versions, prompt_test_results,
 * ai_experiments, experiment_observations, experiment_results,
 * prediction_logs, performance_daily, performance_by_intent
 */

import {
  pgTable, text, serial, timestamp, boolean, integer, numeric, index, date, jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── 1. Correction Queue ────────────────────────────────────────────────────────

export const correctionQueueTable = pgTable("correction_queue", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id").notNull(),
  correctedBy: text("corrected_by").notNull(),
  sessionId: integer("session_id"),
  fieldCorrected: text("field_corrected").notNull(), // intent|routing_role|priority|sla_hours|approval_required|approval_type
  originalValue: text("original_value").notNull(),
  originalConfidence: numeric("original_confidence", { precision: 5, scale: 2 }),
  correctedValue: text("corrected_value").notNull(),
  correctionReason: text("correction_reason"),
  taskSnapshot: jsonb("task_snapshot"),
  status: text("status").notNull().default("pending"), // pending|exported_to_dataset|archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
}, (t) => [
  index("correction_queue_task_idx").on(t.taskId),
  index("correction_queue_status_idx").on(t.status),
  index("correction_queue_company_idx").on(t.companyId),
  index("correction_queue_created_idx").on(t.createdAt),
]);

export const insertCorrectionQueueSchema = createInsertSchema(correctionQueueTable).omit({ id: true, createdAt: true });
export type InsertCorrectionQueue = z.infer<typeof insertCorrectionQueueSchema>;
export type CorrectionQueue = typeof correctionQueueTable.$inferSelect;

// ── 2. Correction Sessions ─────────────────────────────────────────────────────

export const correctionSessionsTable = pgTable("correction_sessions", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id").notNull(),
  reviewedBy: text("reviewed_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  correctionCount: integer("correction_count").notNull().default(0),
  notes: text("notes"),
}, (t) => [
  index("correction_sessions_task_idx").on(t.taskId),
  index("correction_sessions_company_idx").on(t.companyId),
]);

export const insertCorrectionSessionSchema = createInsertSchema(correctionSessionsTable).omit({ id: true });
export type InsertCorrectionSession = z.infer<typeof insertCorrectionSessionSchema>;
export type CorrectionSession = typeof correctionSessionsTable.$inferSelect;

// ── 3. Training Dataset ────────────────────────────────────────────────────────

export const trainingDatasetTable = pgTable("training_dataset", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  correctionId: integer("correction_id"),
  sourceTaskId: integer("source_task_id"),
  originalMessage: text("original_message").notNull(),
  promptVersionId: integer("prompt_version_id"),
  predictedIntent: text("predicted_intent"),
  predictedConfidence: numeric("predicted_confidence", { precision: 5, scale: 2 }),
  predictedRouting: text("predicted_routing"),
  predictedPriority: text("predicted_priority"),
  predictedSlaHours: integer("predicted_sla_hours"),
  predictedApproval: boolean("predicted_approval"),
  fieldCorrected: text("field_corrected").notNull(),
  correctValue: text("correct_value").notNull(),
  correctedBy: text("corrected_by").notNull(),
  correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull().defaultNow(),
  splitTag: text("split_tag").notNull().default("train"), // train|validation|test
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("training_dataset_company_idx").on(t.companyId),
  index("training_dataset_correction_idx").on(t.correctionId),
  index("training_dataset_split_idx").on(t.splitTag),
  index("training_dataset_created_idx").on(t.createdAt),
]);

export const insertTrainingDatasetSchema = createInsertSchema(trainingDatasetTable).omit({ id: true, createdAt: true });
export type InsertTrainingDataset = z.infer<typeof insertTrainingDatasetSchema>;
export type TrainingDataset = typeof trainingDatasetTable.$inferSelect;

// ── 4. Dataset Exports ─────────────────────────────────────────────────────────

export const datasetExportsTable = pgTable("dataset_exports", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  exportedBy: text("exported_by").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  format: text("format").notNull().default("jsonl"),
  fileUrl: text("file_url"),
  filterParams: jsonb("filter_params"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("dataset_exports_company_idx").on(t.companyId),
  index("dataset_exports_created_idx").on(t.createdAt),
]);

export const insertDatasetExportSchema = createInsertSchema(datasetExportsTable).omit({ id: true, createdAt: true });
export type InsertDatasetExport = z.infer<typeof insertDatasetExportSchema>;
export type DatasetExport = typeof datasetExportsTable.$inferSelect;

// ── 5. Accuracy Snapshots ──────────────────────────────────────────────────────

export const accuracySnapshotsTable = pgTable("accuracy_snapshots", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  promptVersionId: integer("prompt_version_id"),
  intentAccuracy: numeric("intent_accuracy", { precision: 5, scale: 2 }),
  routingAccuracy: numeric("routing_accuracy", { precision: 5, scale: 2 }),
  priorityAccuracy: numeric("priority_accuracy", { precision: 5, scale: 2 }),
  slaAccuracy: numeric("sla_accuracy", { precision: 5, scale: 2 }),
  approvalAccuracy: numeric("approval_accuracy", { precision: 5, scale: 2 }),
  fallbackRate: numeric("fallback_rate", { precision: 5, scale: 2 }),
  lowConfidenceRate: numeric("low_confidence_rate", { precision: 5, scale: 2 }),
  correctionRate: numeric("correction_rate", { precision: 5, scale: 2 }),
  totalTasksProcessed: integer("total_tasks_processed").notNull().default(0),
  totalCorrections: integer("total_corrections").notNull().default(0),
  intentBreakdown: jsonb("intent_breakdown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("accuracy_snapshots_company_idx").on(t.companyId),
  index("accuracy_snapshots_at_idx").on(t.snapshotAt),
]);

export const insertAccuracySnapshotSchema = createInsertSchema(accuracySnapshotsTable).omit({ id: true, createdAt: true });
export type InsertAccuracySnapshot = z.infer<typeof insertAccuracySnapshotSchema>;
export type AccuracySnapshot = typeof accuracySnapshotsTable.$inferSelect;

// ── 6. Prompt Versions ────────────────────────────────────────────────────────

export const promptVersionsTable = pgTable("prompt_versions", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  versionLabel: text("version_label").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  promptDiff: text("prompt_diff"),
  changelog: text("changelog"),
  status: text("status").notNull().default("draft"), // draft|testing|active|archived
  promptHash: text("prompt_hash"),
  model: text("model").notNull().default("gpt-4o-mini"),
  parentVersionId: integer("parent_version_id"),
  experimentId: integer("experiment_id"),
  accuracyAtActivation: numeric("accuracy_at_activation", { precision: 5, scale: 2 }),
  accuracyAtArchive: numeric("accuracy_at_archive", { precision: 5, scale: 2 }),
  createdBy: text("created_by").notNull(),
  activatedBy: text("activated_by"),
  archivedBy: text("archived_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  testingStartedAt: timestamp("testing_started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("prompt_versions_company_idx").on(t.companyId),
  index("prompt_versions_status_idx").on(t.status),
  index("prompt_versions_created_idx").on(t.createdAt),
]);

export const insertPromptVersionSchema = createInsertSchema(promptVersionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPromptVersion = z.infer<typeof insertPromptVersionSchema>;
export type PromptVersion = typeof promptVersionsTable.$inferSelect;

// ── 7. Prompt Test Results ────────────────────────────────────────────────────

export const promptTestResultsTable = pgTable("prompt_test_results", {
  id: serial("id").primaryKey(),
  promptVersionId: integer("prompt_version_id").notNull(),
  datasetRecordId: integer("dataset_record_id"),
  predictedIntent: text("predicted_intent"),
  predictedConfidence: numeric("predicted_confidence", { precision: 5, scale: 2 }),
  predictedRouting: text("predicted_routing"),
  predictedApproval: boolean("predicted_approval"),
  intentCorrect: boolean("intent_correct"),
  routingCorrect: boolean("routing_correct"),
  approvalCorrect: boolean("approval_correct"),
  latencyMs: integer("latency_ms"),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("prompt_test_results_version_idx").on(t.promptVersionId),
  index("prompt_test_results_run_at_idx").on(t.runAt),
]);

export const insertPromptTestResultSchema = createInsertSchema(promptTestResultsTable).omit({ id: true });
export type InsertPromptTestResult = z.infer<typeof insertPromptTestResultSchema>;
export type PromptTestResult = typeof promptTestResultsTable.$inferSelect;

// ── 8. AI Experiments ─────────────────────────────────────────────────────────

export const aiExperimentsTable = pgTable("ai_experiments", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  name: text("name").notNull(),
  description: text("description"),
  controlVersionId: integer("control_version_id").notNull(),
  challengerVersionId: integer("challenger_version_id").notNull(),
  challengerTrafficPct: integer("challenger_traffic_pct").notNull().default(20),
  primaryMetric: text("primary_metric").notNull().default("intent_accuracy"),
  minSampleSize: integer("min_sample_size").notNull().default(100),
  status: text("status").notNull().default("draft"), // draft|running|paused|concluded|archived
  conclusion: text("conclusion"),
  conclusionNotes: text("conclusion_notes"),
  createdBy: text("created_by").notNull(),
  concludedBy: text("concluded_by"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ai_experiments_company_idx").on(t.companyId),
  index("ai_experiments_status_idx").on(t.status),
]);

export const insertAiExperimentSchema = createInsertSchema(aiExperimentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiExperiment = z.infer<typeof insertAiExperimentSchema>;
export type AiExperiment = typeof aiExperimentsTable.$inferSelect;

// ── 9. Experiment Observations ────────────────────────────────────────────────

export const experimentObservationsTable = pgTable("experiment_observations", {
  id: serial("id").primaryKey(),
  experimentId: integer("experiment_id").notNull(),
  taskId: integer("task_id"),
  promptVersionId: integer("prompt_version_id").notNull(),
  groupTag: text("group_tag").notNull(), // control|challenger
  predictedIntent: text("predicted_intent"),
  predictedConfidence: numeric("predicted_confidence", { precision: 5, scale: 2 }),
  predictedRouting: text("predicted_routing"),
  predictedApproval: boolean("predicted_approval"),
  intentCorrect: boolean("intent_correct"),
  routingCorrect: boolean("routing_correct"),
  approvalCorrect: boolean("approval_correct"),
  wasCorrected: boolean("was_corrected").notNull().default(false),
  correctionId: integer("correction_id"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  outcomeDeterminedAt: timestamp("outcome_determined_at", { withTimezone: true }),
}, (t) => [
  index("experiment_observations_exp_idx").on(t.experimentId),
  index("experiment_observations_task_idx").on(t.taskId),
  index("experiment_observations_observed_idx").on(t.observedAt),
]);

export const insertExperimentObservationSchema = createInsertSchema(experimentObservationsTable).omit({ id: true });
export type InsertExperimentObservation = z.infer<typeof insertExperimentObservationSchema>;
export type ExperimentObservation = typeof experimentObservationsTable.$inferSelect;

// ── 10. Experiment Results ─────────────────────────────────────────────────────

export const experimentResultsTable = pgTable("experiment_results", {
  id: serial("id").primaryKey(),
  experimentId: integer("experiment_id").notNull().unique(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  controlSampleSize: integer("control_sample_size").notNull().default(0),
  controlIntentAccuracy: numeric("control_intent_accuracy", { precision: 5, scale: 2 }),
  controlRoutingAccuracy: numeric("control_routing_accuracy", { precision: 5, scale: 2 }),
  controlAvgConfidence: numeric("control_avg_confidence", { precision: 5, scale: 2 }),
  controlCorrectionRate: numeric("control_correction_rate", { precision: 5, scale: 2 }),
  challengerSampleSize: integer("challenger_sample_size").notNull().default(0),
  challengerIntentAccuracy: numeric("challenger_intent_accuracy", { precision: 5, scale: 2 }),
  challengerRoutingAccuracy: numeric("challenger_routing_accuracy", { precision: 5, scale: 2 }),
  challengerAvgConfidence: numeric("challenger_avg_confidence", { precision: 5, scale: 2 }),
  challengerCorrectionRate: numeric("challenger_correction_rate", { precision: 5, scale: 2 }),
  intentAccuracyDelta: numeric("intent_accuracy_delta", { precision: 5, scale: 2 }),
  confidenceDelta: numeric("confidence_delta", { precision: 5, scale: 2 }),
  correctionRateDelta: numeric("correction_rate_delta", { precision: 5, scale: 2 }),
}, (t) => [
  index("experiment_results_exp_idx").on(t.experimentId),
]);

export const insertExperimentResultSchema = createInsertSchema(experimentResultsTable).omit({ id: true });
export type InsertExperimentResult = z.infer<typeof insertExperimentResultSchema>;
export type ExperimentResult = typeof experimentResultsTable.$inferSelect;

// ── 11. Prediction Logs ───────────────────────────────────────────────────────
// Compact: no full prompt stored — only hash + version_id + result summary

export const predictionLogsTable = pgTable("prediction_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id"),
  promptVersionId: integer("prompt_version_id"),
  promptHash: text("prompt_hash"),
  model: text("model").notNull().default("gpt-4o-mini"),
  experimentId: integer("experiment_id"),
  experimentGroup: text("experiment_group"),
  predictedIntent: text("predicted_intent"),
  predictedCategory: text("predicted_category"),
  predictedPriority: text("predicted_priority"),
  predictedConfidence: text("predicted_confidence"),       // high|medium|low
  predictedConfidenceNumeric: numeric("predicted_confidence_numeric", { precision: 5, scale: 2 }),
  predictedRouting: text("predicted_routing"),
  predictedApproval: boolean("predicted_approval").notNull().default(false),
  isFallback: boolean("is_fallback").notNull().default(false),
  keywordScore: numeric("keyword_score", { precision: 5, scale: 3 }),
  llmLatencyMs: integer("llm_latency_ms"),
  totalLatencyMs: integer("total_latency_ms"),
  outcomeIntentCorrect: boolean("outcome_intent_correct"),
  outcomeRoutingCorrect: boolean("outcome_routing_correct"),
  wasCorrected: boolean("was_corrected").notNull().default(false),
  predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull().defaultNow(),
  outcomeDeterminedAt: timestamp("outcome_determined_at", { withTimezone: true }),
}, (t) => [
  index("prediction_logs_task_idx").on(t.taskId),
  index("prediction_logs_company_idx").on(t.companyId),
  index("prediction_logs_predicted_at_idx").on(t.predictedAt),
  index("prediction_logs_intent_idx").on(t.predictedIntent),
  index("prediction_logs_version_idx").on(t.promptVersionId),
]);

export const insertPredictionLogSchema = createInsertSchema(predictionLogsTable).omit({ id: true });
export type InsertPredictionLog = z.infer<typeof insertPredictionLogSchema>;
export type PredictionLog = typeof predictionLogsTable.$inferSelect;

// ── 12. Performance Daily ─────────────────────────────────────────────────────

export const performanceDailyTable = pgTable("performance_daily", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  date: date("date").notNull(),
  promptVersionId: integer("prompt_version_id"),
  totalPredictions: integer("total_predictions").notNull().default(0),
  totalCorrections: integer("total_corrections").notNull().default(0),
  totalFallbacks: integer("total_fallbacks").notNull().default(0),
  totalLowConfidence: integer("total_low_confidence").notNull().default(0),
  intentAccuracy: numeric("intent_accuracy", { precision: 5, scale: 2 }),
  routingAccuracy: numeric("routing_accuracy", { precision: 5, scale: 2 }),
  approvalAccuracy: numeric("approval_accuracy", { precision: 5, scale: 2 }),
  fallbackRate: numeric("fallback_rate", { precision: 5, scale: 2 }),
  correctionRate: numeric("correction_rate", { precision: 5, scale: 2 }),
  lowConfidenceRate: numeric("low_confidence_rate", { precision: 5, scale: 2 }),
  avgConfidence: numeric("avg_confidence", { precision: 5, scale: 2 }),
  avgLlmLatencyMs: integer("avg_llm_latency_ms"),
  p95LlmLatencyMs: integer("p95_llm_latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("performance_daily_company_idx").on(t.companyId),
  index("performance_daily_date_idx").on(t.date),
]);

export const insertPerformanceDailySchema = createInsertSchema(performanceDailyTable).omit({ id: true, createdAt: true });
export type InsertPerformanceDaily = z.infer<typeof insertPerformanceDailySchema>;
export type PerformanceDaily = typeof performanceDailyTable.$inferSelect;

// ── 13. Performance By Intent ─────────────────────────────────────────────────

export const performanceByIntentTable = pgTable("performance_by_intent", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  date: date("date").notNull(),
  intentCode: text("intent_code").notNull(),
  promptVersionId: integer("prompt_version_id"),
  sampleCount: integer("sample_count").notNull().default(0),
  accuracyRate: numeric("accuracy_rate", { precision: 5, scale: 2 }),
  avgConfidence: numeric("avg_confidence", { precision: 5, scale: 2 }),
  correctionCount: integer("correction_count").notNull().default(0),
  fallbackCount: integer("fallback_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("performance_by_intent_company_idx").on(t.companyId),
  index("performance_by_intent_date_idx").on(t.date),
  index("performance_by_intent_code_idx").on(t.intentCode),
]);

export const insertPerformanceByIntentSchema = createInsertSchema(performanceByIntentTable).omit({ id: true, createdAt: true });
export type InsertPerformanceByIntent = z.infer<typeof insertPerformanceByIntentSchema>;
export type PerformanceByIntent = typeof performanceByIntentTable.$inferSelect;
