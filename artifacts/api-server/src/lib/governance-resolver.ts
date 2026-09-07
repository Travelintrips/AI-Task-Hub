import { db, routingRulesTable, slaMatrixTable, approvalRulesTable } from "@workspace/db";
import { eq, and, isNull, or } from "drizzle-orm";

// ─── Specificity cascade helper ────────────────────────────────────────────────
// Priority order (most specific → least):
//  1. intentCode + category + priority
//  2. intentCode + category
//  3. intentCode only
//  4. category + priority
//  5. category only
//  6. priority only
//  7. fallback (all null)

function scoreRoutingRule(rule: { intentCode: string | null; category: string | null; priority: string | null }, input: { intentCode: string | null; category: string | null; priority: string | null }): number {
  let score = 0;
  if (rule.intentCode && rule.intentCode === input.intentCode) score += 4;
  if (rule.category && rule.category === input.category) score += 2;
  if (rule.priority && rule.priority === input.priority) score += 1;
  if (rule.intentCode && rule.intentCode !== input.intentCode) return -1;
  if (rule.category && rule.category !== input.category) return -1;
  if (rule.priority && rule.priority !== input.priority) return -1;
  return score;
}

// ─── Routing resolver ─────────────────────────────────────────────────────────

export interface RoutingResolution {
  assignedRole: string | null;
  assignedDivision: string | null;
  assignedTeam: string | null;
  ruleId: number | null;
  specificity: number;
}

export async function resolveRouting(
  companyId: string,
  intentCode: string | null,
  category: string | null,
  priority: string | null,
): Promise<RoutingResolution> {
  const rules = await db
    .select()
    .from(routingRulesTable)
    .where(and(eq(routingRulesTable.companyId, companyId), eq(routingRulesTable.isActive, true)));

  let best: (typeof rules)[0] | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    const score = scoreRoutingRule(rule, { intentCode, category, priority });
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }

  return {
    assignedRole: best?.assignedRole ?? null,
    assignedDivision: best?.assignedDivision ?? null,
    assignedTeam: best?.assignedTeam ?? null,
    ruleId: best?.id ?? null,
    specificity: bestScore,
  };
}

// ─── SLA resolver ─────────────────────────────────────────────────────────────

export interface SlaResolution {
  slaHours: number | null;
  escalationHours: number | null;
  ruleId: number | null;
  specificity: number;
}

function scoreSlaRule(rule: { intentCode: string | null; category: string | null; priority: string | null }, input: { intentCode: string | null; category: string | null; priority: string | null }): number {
  let score = 0;
  if (rule.intentCode && rule.intentCode === input.intentCode) score += 4;
  if (rule.category && rule.category === input.category) score += 2;
  if (rule.priority && rule.priority === input.priority) score += 1;
  if (rule.intentCode && rule.intentCode !== input.intentCode) return -1;
  if (rule.category && rule.category !== input.category) return -1;
  if (rule.priority && rule.priority !== input.priority) return -1;
  return score;
}

export async function resolveSla(
  companyId: string,
  intentCode: string | null,
  category: string | null,
  priority: string | null,
): Promise<SlaResolution> {
  const rules = await db
    .select()
    .from(slaMatrixTable)
    .where(and(eq(slaMatrixTable.companyId, companyId), eq(slaMatrixTable.isActive, true)));

  let best: (typeof rules)[0] | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    const score = scoreSlaRule(rule, { intentCode, category, priority });
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }

  return {
    slaHours: best?.slaHours ?? null,
    escalationHours: best?.escalationHours ?? null,
    ruleId: best?.id ?? null,
    specificity: bestScore,
  };
}

// ─── Approval resolver ────────────────────────────────────────────────────────

export interface ApprovalResolution {
  needsApproval: boolean;
  approvalType: string | null;
  approverRole: string | null;
  requiresNote: boolean;
  timeoutHours: number;
  ruleId: number | null;
  specificity: number;
}

function scoreApprovalRule(rule: { intentCode: string | null; category: string | null; priority: string | null }, input: { intentCode: string | null; category: string | null; priority: string | null }): number {
  let score = 0;
  if (rule.intentCode && rule.intentCode === input.intentCode) score += 4;
  if (rule.category && rule.category === input.category) score += 2;
  if (rule.priority && rule.priority === input.priority) score += 1;
  if (rule.intentCode && rule.intentCode !== input.intentCode) return -1;
  if (rule.category && rule.category !== input.category) return -1;
  if (rule.priority && rule.priority !== input.priority) return -1;
  return score;
}

export async function resolveApproval(
  companyId: string,
  intentCode: string | null,
  category: string | null,
  priority: string | null,
): Promise<ApprovalResolution> {
  const rules = await db
    .select()
    .from(approvalRulesTable)
    .where(and(eq(approvalRulesTable.companyId, companyId), eq(approvalRulesTable.isActive, true)));

  let best: (typeof rules)[0] | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    const score = scoreApprovalRule(rule, { intentCode, category, priority });
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }

  if (!best) {
    return { needsApproval: false, approvalType: null, approverRole: null, requiresNote: false, timeoutHours: 24, ruleId: null, specificity: -1 };
  }

  return {
    needsApproval: true,
    approvalType: best.approvalType,
    approverRole: best.approverRole,
    requiresNote: best.requiresNote,
    timeoutHours: best.timeoutHours,
    ruleId: best.id,
    specificity: bestScore,
  };
}
