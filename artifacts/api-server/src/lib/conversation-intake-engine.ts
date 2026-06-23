/**
 * conversation-intake-engine.ts — Sprint 9A Phase 2
 *
 * Structured session engine with named methods per sprint spec.
 * Wraps and extends the lower-level intake-engine.ts functions.
 *
 * Methods:
 *   findOrCreateSession()
 *   updateSessionField()
 *   calculateCompletion()
 *   getMissingFields()
 *   generateNextQuestion()  (via OpenAI)
 *   completeSession()
 *   cancelSession()
 *   expireSession()
 */

import { eq, and, inArray, lte, isNotNull } from "drizzle-orm";
import {
  db,
  intakeSessionsTable,
  dataTemplatesTable,
  dataTemplateFieldsTable,
  customerMemorySnapshotsTable,
  customersTable,
  auditLogsTable,
  type IntakeSession,
} from "@workspace/db";
import { openai } from "./openai";
import { logger } from "./logger";
import type { IntentResolution } from "./intent-engine";
import { calculateCompleteness, getCompletionThreshold } from "./intake-completeness";

export type { IntakeSession };

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SessionFieldDef {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
  helpText?: string | null;
}

export interface SessionContext {
  phone: string;
  companyId: string;
  intentCode: string;
  intentName?: string | null;
  category?: string | null;
  resolution: IntentResolution;
  initialMessage: string;
}

// ─── Load required fields from data_templates ──────────────────────────────────

async function loadTemplateFields(
  intentCode: string,
  category: string | null,
  companyId: string,
): Promise<SessionFieldDef[]> {
  const tpl = await db
    .select()
    .from(dataTemplatesTable)
    .where(
      and(
        eq(dataTemplatesTable.companyId, companyId),
        eq(dataTemplatesTable.isActive, true),
        eq(dataTemplatesTable.intentCode, intentCode),
      ),
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  const fallbackTpl = !tpl && category
    ? await db
        .select()
        .from(dataTemplatesTable)
        .where(
          and(
            eq(dataTemplatesTable.companyId, companyId),
            eq(dataTemplatesTable.isActive, true),
            eq(dataTemplatesTable.category, category),
          ),
        )
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  const activeTpl = tpl ?? fallbackTpl;
  if (!activeTpl) return [];

  const fields = await db
    .select()
    .from(dataTemplateFieldsTable)
    .where(eq(dataTemplateFieldsTable.templateId, activeTpl.id))
    .orderBy(dataTemplateFieldsTable.sortOrder);

  return fields.map((f) => ({
    fieldName:  f.fieldName,
    fieldLabel: f.fieldLabel,
    fieldType:  f.fieldType,
    isRequired: f.isRequired,
    sortOrder:  f.sortOrder,
    helpText:   f.helpText ?? null,
  }));
}

// ─── Load customer memory for prefill ─────────────────────────────────────────

async function loadCustomerMemoryBlock(
  phone: string,
  companyId: string,
): Promise<string | null> {
  try {
    const customer = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.companyId, companyId),
          eq(customersTable.picPhone, phone),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!customer) return null;

    const snapshot = await db
      .select({ aiContextBlock: customerMemorySnapshotsTable.aiContextBlock })
      .from(customerMemorySnapshotsTable)
      .where(
        and(
          eq(customerMemorySnapshotsTable.companyId, companyId),
          eq(customerMemorySnapshotsTable.customerId, customer.id),
          eq(customerMemorySnapshotsTable.isStale, false),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    return snapshot?.aiContextBlock ?? null;
  } catch (err) {
    logger.warn({ err, phone }, "ConversationIntakeEngine: failed to load customer memory");
    return null;
  }
}

// ─── Write audit log ──────────────────────────────────────────────────────────

async function writeAuditLog(
  action: string,
  sessionId: number,
  companyId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      companyId,
      action,
      module: "intake",
      entityType: "intake_session",
      entityId: sessionId,
      after: JSON.stringify({ sessionId, ...metadata }),
    });
  } catch (err) {
    logger.warn({ err, action, sessionId }, "ConversationIntakeEngine: audit log write failed");
  }
}

// ─── ConversationIntakeEngine class ───────────────────────────────────────────

export class ConversationIntakeEngine {
  // ── findOrCreateSession ──────────────────────────────────────────────────────

  async findOrCreateSession(ctx: SessionContext): Promise<IntakeSession> {
    const now = new Date();

    const existing = await db
      .select()
      .from(intakeSessionsTable)
      .where(
        and(
          eq(intakeSessionsTable.phone, ctx.phone),
          eq(intakeSessionsTable.companyId, ctx.companyId),
          inArray(intakeSessionsTable.status, ["collecting", "form_sent", "ready_for_task"]),
        ),
      )
      .orderBy(intakeSessionsTable.updatedAt)
      .limit(1)
      .then((r) => r[0] ?? null);

    if (existing) {
      if (existing.expiresAt && existing.expiresAt < now) {
        await this.expireSession(existing.id);
      } else {
        logger.info({ sessionId: existing.id, phone: ctx.phone }, "ConversationIntakeEngine: resumed existing session");
        return existing;
      }
    }

    const fields = await loadTemplateFields(ctx.intentCode, ctx.category ?? null, ctx.companyId);
    const requiredFieldNames = fields.filter((f) => f.isRequired).map((f) => f.fieldName);

    const memoryBlock = await loadCustomerMemoryBlock(ctx.phone, ctx.companyId);
    const prefilled = memoryBlock
      ? await this._prefillFromMemory(fields, ctx.intentCode, memoryBlock)
      : {};

    const completeness = calculateCompleteness(requiredFieldNames, prefilled, ctx.intentCode);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [session] = await db
      .insert(intakeSessionsTable)
      .values({
        phone:        ctx.phone,
        companyId:    ctx.companyId,
        intentCode:   ctx.intentCode,
        intentName:   ctx.intentName ?? null,
        category:     ctx.category ?? null,
        status:       "collecting",
        requiredFields:  requiredFieldNames,
        collectedFields: prefilled,
        missingFields:   completeness.missingFieldNames,
        requiredDocuments: ctx.resolution.missingDocuments.map((d) => (typeof d === "string" ? d : (d as { documentName?: string }).documentName ?? String(d))),
        uploadedDocuments: [],
        confidenceScore:   String(ctx.resolution.keywordScore ?? 0),
        completionPct:     String(completeness.completionPct),
        needsAdminReview:  ctx.resolution.needsAdminReview ?? false,
        lastMessage:       ctx.initialMessage,
        lastMessageAt:     now,
        expiresAt,
      })
      .returning();

    await writeAuditLog("session_created", session!.id, ctx.companyId, {
      intentCode: ctx.intentCode,
      requiredFields: requiredFieldNames,
      prefillCount: Object.keys(prefilled).length,
    });

    logger.info(
      { sessionId: session!.id, intentCode: ctx.intentCode, prefilled: Object.keys(prefilled).length },
      "ConversationIntakeEngine: new session created",
    );

    return session!;
  }

  // ── updateSessionField ───────────────────────────────────────────────────────

  async updateSessionField(
    sessionId: number,
    fieldName: string,
    value: unknown,
    companyId: string,
  ): Promise<IntakeSession> {
    const [current] = await db
      .select()
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.id, sessionId))
      .limit(1);

    if (!current) throw new Error(`Session ${sessionId} not found`);

    const existing = (current.collectedFields as Record<string, unknown>) ?? {};
    const newCollected = { ...existing, [fieldName]: value };

    const requiredFields = (current.requiredFields as string[]) ?? [];
    const completeness = calculateCompleteness(requiredFields, newCollected, current.intentCode);

    const [updated] = await db
      .update(intakeSessionsTable)
      .set({
        collectedFields: newCollected,
        missingFields:   completeness.missingFieldNames,
        completionPct:   String(completeness.completionPct),
        lastMessageAt:   new Date(),
        updatedAt:       new Date(),
      })
      .where(eq(intakeSessionsTable.id, sessionId))
      .returning();

    await writeAuditLog("field_collected", sessionId, companyId, { fieldName, completionPct: completeness.completionPct });

    if (completeness.isReady) {
      await writeAuditLog("completion_threshold_reached", sessionId, companyId, {
        pct:       completeness.completionPct,
        threshold: completeness.threshold,
      });
    }

    return updated!;
  }

  // ── calculateCompletion ──────────────────────────────────────────────────────

  calculateCompletion(session: IntakeSession) {
    const required = (session.requiredFields as string[]) ?? [];
    const collected = (session.collectedFields as Record<string, unknown>) ?? {};
    return calculateCompleteness(required, collected, session.intentCode);
  }

  // ── getMissingFields ─────────────────────────────────────────────────────────

  getMissingFields(session: IntakeSession): string[] {
    const required = (session.requiredFields as string[]) ?? [];
    const collected = (session.collectedFields as Record<string, unknown>) ?? {};
    return required.filter((f) => {
      const v = collected[f];
      return v === null || v === undefined || v === "";
    });
  }

  // ── generateNextQuestion ─────────────────────────────────────────────────────

  async generateNextQuestion(
    session: IntakeSession,
    fieldDefs: SessionFieldDef[],
    memoryContext?: string | null,
  ): Promise<string> {
    const missing = this.getMissingFields(session);
    if (missing.length === 0) {
      return "Terima kasih! Semua informasi sudah lengkap. Tim kami akan segera memproses permintaan Anda. 🙏";
    }

    const toAsk = missing.slice(0, 2);
    const toAskDefs = fieldDefs.filter((f) => toAsk.includes(f.fieldName));
    const collected = (session.collectedFields as Record<string, unknown>) ?? {};

    const memoryHint = memoryContext
      ? `\n\nKonteks memori pelanggan (gunakan untuk menyebutkan preferensi jika relevan):\n${memoryContext}`
      : "";

    const prompt = `Kamu adalah customer service profesional dari perusahaan logistik Indonesia.
Intent pelanggan: ${session.intentCode}

Data yang sudah terkumpul:
${JSON.stringify(collected, null, 2)}

Field yang perlu ditanyakan selanjutnya:
${toAskDefs.map((f) => `- ${f.fieldLabel}${f.helpText ? ` (${f.helpText})` : ""}`).join("\n")}
${memoryHint}

Buat SATU pertanyaan natural dalam Bahasa Indonesia — singkat, ramah, profesional.
- Jika ada memori pelanggan yang relevan, sebutkan sebagai saran (misal: "biasanya dari Jakarta ke Surabaya, apakah sama?")
- Jangan tanyakan field yang sudah terkumpul
- Maksimal 3 kalimat

Kembalikan HANYA teks pertanyaannya.`;

    try {
      const resp = await openai.chat.completions.create({
        model:           "gpt-4o-mini",
        messages:        [{ role: "user", content: prompt }],
        temperature:     0.7,
        max_tokens:      200,
      });
      return resp.choices[0]?.message?.content?.trim()
        ?? `Boleh saya tanyakan: ${toAskDefs.map((f) => f.fieldLabel).join(" dan ")}?`;
    } catch {
      return `Boleh saya tanyakan informasi berikut: ${toAskDefs.map((f) => f.fieldLabel).join(" dan ")}?`;
    }
  }

  // ── completeSession ──────────────────────────────────────────────────────────

  async completeSession(
    sessionId: number,
    taskId: string | number,
    companyId: string,
    aiSummary?: string,
  ): Promise<IntakeSession> {
    const [updated] = await db
      .update(intakeSessionsTable)
      .set({
        status:       "submitted",
        taskId:       String(taskId),
        aiSummary:    aiSummary ?? null,
        completionPct: "100",
        updatedAt:    new Date(),
      })
      .where(eq(intakeSessionsTable.id, sessionId))
      .returning();

    await writeAuditLog("task_created_from_session", sessionId, companyId, { taskId });

    return updated!;
  }

  // ── cancelSession ────────────────────────────────────────────────────────────

  async cancelSession(sessionId: number, companyId: string): Promise<IntakeSession> {
    const [updated] = await db
      .update(intakeSessionsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(intakeSessionsTable.id, sessionId))
      .returning();

    await writeAuditLog("session_cancelled", sessionId, companyId, {});

    return updated!;
  }

  // ── expireSession ────────────────────────────────────────────────────────────

  async expireSession(sessionId: number): Promise<void> {
    const [row] = await db
      .update(intakeSessionsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(intakeSessionsTable.id, sessionId))
      .returning({ companyId: intakeSessionsTable.companyId });

    if (row) {
      await writeAuditLog("session_expired", sessionId, row.companyId, {});
    }
  }

  // ── Bulk expire all stale sessions (called by scheduler) ──────────────────────

  async expireOldSessions(): Promise<number> {
    const now = new Date();
    const expired = await db
      .update(intakeSessionsTable)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          inArray(intakeSessionsTable.status, ["collecting", "ready_for_task", "form_sent"]),
          isNotNull(intakeSessionsTable.expiresAt),
          lte(intakeSessionsTable.expiresAt, now),
        ),
      )
      .returning({ id: intakeSessionsTable.id, companyId: intakeSessionsTable.companyId });

    for (const s of expired) {
      await writeAuditLog("session_expired", s.id, s.companyId, { bulk: true });
    }

    return expired.length;
  }

  // ── Internal: prefill from customer memory ────────────────────────────────────

  private async _prefillFromMemory(
    fields: SessionFieldDef[],
    intentCode: string,
    memoryBlock: string,
  ): Promise<Record<string, unknown>> {
    if (fields.length === 0) return {};

    const fieldList = fields
      .filter((f) => f.isRequired)
      .map((f) => `- ${f.fieldName} (${f.fieldLabel})`)
      .join("\n");

    const prompt = `Kamu adalah AI yang mengekstrak data dari memori pelanggan untuk prefill form.

Intent: ${intentCode}
Fields yang dibutuhkan:
${fieldList}

Memori pelanggan:
${memoryBlock}

Dari memori di atas, ekstrak nilai yang JELAS tersedia untuk field-field tersebut.
Kembalikan JSON object. Hanya sertakan field yang nilainya jelas dari memori — jangan asumsikan.
Kembalikan {} jika tidak ada yang bisa diprefill.`;

    try {
      const resp = await openai.chat.completions.create({
        model:           "gpt-4o-mini",
        messages:        [{ role: "user", content: prompt }],
        temperature:     0.1,
        max_tokens:      400,
        response_format: { type: "json_object" },
      });
      const raw = resp.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== null && v !== undefined && v !== "") cleaned[k] = v;
      }
      return cleaned;
    } catch {
      return {};
    }
  }
}

export const intakeEngine = new ConversationIntakeEngine();

// ─── Convenience re-exports for scheduler use ─────────────────────────────────

export async function expireOldIntakeSessionsV2(): Promise<number> {
  return intakeEngine.expireOldSessions();
}
