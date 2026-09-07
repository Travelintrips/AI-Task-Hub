/**
 * Sprint 9D — Conversation Test Suite & AI Quality Gate
 *
 * Tables:
 *   conversation_test_cases   — test case definitions
 *   conversation_test_runs    — test run header (aggregate)
 *   conversation_test_results — per-case results within a run
 */

import {
  pgTable, text, serial, timestamp, boolean, integer, real, jsonb, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Test Cases ─────────────────────────────────────────────────────────────────

export const conversationTestCasesTable = pgTable("conversation_test_cases", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  testName: text("test_name").notNull(),
  intentCode: text("intent_code"),
  scenarioType: text("scenario_type").notNull().default("normal"),

  inputMessages: jsonb("input_messages").notNull().default([]),

  expectedBehavior: jsonb("expected_behavior").notNull().default({}),
  expectedIntentCode: text("expected_intent_code"),
  expectedIntakeMode: text("expected_intake_mode"),
  expectedTaskCreated: boolean("expected_task_created").notNull().default(false),
  expectedMiniFormSent: boolean("expected_mini_form_sent").notNull().default(false),
  expectedAdminHandoff: boolean("expected_admin_handoff").notNull().default(false),
  expectedMissingFields: jsonb("expected_missing_fields").notNull().default([]),

  isCritical: boolean("is_critical").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("conv_test_cases_company_idx").on(t.companyId),
  index("conv_test_cases_active_idx").on(t.isActive),
]);

export const insertConversationTestCaseSchema = createInsertSchema(conversationTestCasesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertConversationTestCase = z.infer<typeof insertConversationTestCaseSchema>;
export type ConversationTestCase = typeof conversationTestCasesTable.$inferSelect;

// ── Test Runs ──────────────────────────────────────────────────────────────────

export const TEST_RUN_STATUSES = ["running", "passed", "failed", "partial"] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export const conversationTestRunsTable = pgTable("conversation_test_runs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  runName: text("run_name").notNull(),
  totalCases: integer("total_cases").notNull().default(0),
  passedCases: integer("passed_cases").notNull().default(0),
  failedCases: integer("failed_cases").notNull().default(0),
  passRate: real("pass_rate").notNull().default(0),
  status: text("status").notNull().default("running"),
  qualityGatePassed: boolean("quality_gate_passed"),
  gateDetails: jsonb("gate_details").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdBy: text("created_by"),
}, (t) => [
  index("conv_test_runs_company_idx").on(t.companyId),
  index("conv_test_runs_status_idx").on(t.status),
]);

export const insertConversationTestRunSchema = createInsertSchema(conversationTestRunsTable).omit({
  id: true,
});
export type InsertConversationTestRun = z.infer<typeof insertConversationTestRunSchema>;
export type ConversationTestRun = typeof conversationTestRunsTable.$inferSelect;

// ── Test Results ───────────────────────────────────────────────────────────────

export const conversationTestResultsTable = pgTable("conversation_test_results", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  runId: integer("run_id").notNull(),
  testCaseId: integer("test_case_id").notNull(),
  status: text("status").notNull().default("failed"),

  actualIntentCode: text("actual_intent_code"),
  actualIntakeMode: text("actual_intake_mode"),
  actualTaskCreated: boolean("actual_task_created").notNull().default(false),
  actualMiniFormSent: boolean("actual_mini_form_sent").notNull().default(false),
  actualAdminHandoff: boolean("actual_admin_handoff").notNull().default(false),
  actualMissingFields: jsonb("actual_missing_fields").notNull().default([]),
  actualReply: text("actual_reply"),
  actualConfidenceScore: text("actual_confidence_score"),

  failureReason: text("failure_reason"),
  durationMs: integer("duration_ms"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("conv_test_results_run_idx").on(t.runId),
  index("conv_test_results_case_idx").on(t.testCaseId),
  index("conv_test_results_status_idx").on(t.status),
]);

export const insertConversationTestResultSchema = createInsertSchema(conversationTestResultsTable).omit({
  id: true, createdAt: true,
});
export type InsertConversationTestResult = z.infer<typeof insertConversationTestResultSchema>;
export type ConversationTestResult = typeof conversationTestResultsTable.$inferSelect;
